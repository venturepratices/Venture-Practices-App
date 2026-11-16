import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { fail, failResponse, readJson } from "@/lib/sales/http";
import { startImportRun } from "@/lib/sales/pipedrive/import";
import { pipedriveClientFromEnv, TOKEN_NOT_SET } from "@/lib/sales/pipedrive/import-check";
import { FINAL_WORD } from "@/lib/sales/pipedrive/import-view-model";

const startSchema = z.strictObject({
  mode: z.enum(["DRY_RUN", "LIVE", "FINAL"], { error: "Pick a practice run, a real copy or the final copy." }),
  confirm: z.string().max(20).optional(),
});

/**
 * Admin: start a copy from Pipedrive. `DRY_RUN` saves nothing, `LIVE` copies,
 * `FINAL` is a real copy that locks copying for good once it finishes and
 * needs `confirm: "LOCK"`. Answers `{ runId }`; the screen then calls
 * `continue` until the run is done. The engine refuses a second running copy
 * and any real copy after the lock (409, in its own words).
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson(request, startSchema);
    if (!body.ok) return failResponse(body);

    const isFinal = body.data.mode === "FINAL";
    if (isFinal && body.data.confirm !== FINAL_WORD) {
      return failResponse(fail(400, `Type ${FINAL_WORD} to confirm the final copy.`));
    }
    if (!pipedriveClientFromEnv()) return failResponse(fail(400, TOKEN_NOT_SET));

    const result = await startImportRun({
      mode: isFinal ? "LIVE" : (body.data.mode as "DRY_RUN" | "LIVE"),
      isFinal,
      startedById: admin.userId,
    });
    if (!result.ok) return failResponse(fail(409, result.message));
    return NextResponse.json({ runId: result.runId });
  } catch (error) {
    return toErrorResponse(error);
  }
}
