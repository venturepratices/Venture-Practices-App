import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { fail, failResponse, readJson } from "@/lib/sales/http";
import { continueImportRun } from "@/lib/sales/pipedrive/import";
import { pipedriveClientFromEnv, TOKEN_NOT_SET } from "@/lib/sales/pipedrive/import-check";

// One chunk works for up to 45 seconds; the rest is room to save and answer.
export const maxDuration = 60;

const CHUNK_MS = 45_000;

const continueSchema = z.strictObject({ runId: z.string().min(1).max(100) });

/** A 404 or 409 answer when the run is gone or no longer running, else null. */
async function notRunningAnswer(runId: string): Promise<Response | null> {
  const run = await prisma.salesImportRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (!run) return failResponse(fail(404, "That copy was not found."));
  if (run.status !== "RUNNING") return failResponse(fail(409, "This copy is not running any more."));
  return null;
}

/**
 * Admin: carry a running copy forward for one chunk. Answers
 * `{ done, paused, phase, counts }`. `paused` means Pipedrive asked us to slow
 * down; the screen waits a minute and calls again. A run that is not running
 * answers 409.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await readJson(request, continueSchema);
    if (!body.ok) return failResponse(body);

    const notRunning = await notRunningAnswer(body.data.runId);
    if (notRunning) return notRunning;

    const client = pipedriveClientFromEnv();
    if (!client) return failResponse(fail(400, TOKEN_NOT_SET));

    let result: Awaited<ReturnType<typeof continueImportRun>>;
    try {
      result = await continueImportRun({
        runId: body.data.runId,
        client,
        deadline: new Date(Date.now() + CHUNK_MS),
        now: () => new Date(),
      });
    } catch (error) {
      // The run can finish or fail (another window carried it) between the look above and the
      // engine's own read, which then refuses it. That is a plain 409; anything else is a real error.
      const ended = await notRunningAnswer(body.data.runId);
      if (ended) return ended;
      throw error;
    }
    return NextResponse.json({ done: result.done, paused: result.paused, phase: result.phase, counts: result.counts });
  } catch (error) {
    return toErrorResponse(error);
  }
}
