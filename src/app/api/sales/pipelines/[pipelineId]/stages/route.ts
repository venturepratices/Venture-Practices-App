import { NextResponse } from "next/server";

import { requireAdmin, toErrorResponse } from "@/lib/permissions";
import { requestMeta } from "@/lib/sales/audit";
import { adminActor } from "@/lib/sales/bot-admin";
import { failResponse, readJson } from "@/lib/sales/http";
import { stageRottingSchema, updateStageRotting } from "@/lib/sales/settings";

type Context = { params: Promise<{ pipelineId: string }> };

/**
 * Admin: how many days a deal may sit in each stage of a Sales or Consulting
 * pipeline before it goes stale (`{ stages: [{ id, rottingDays }] }`, 1 to 365,
 * null for never). One history row per stage whose number changed. Answers
 * `{ stages }` as saved.
 */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const admin = await requireAdmin();
    const body = await readJson(request, stageRottingSchema);
    if (!body.ok) return failResponse(body);
    const { pipelineId } = await params;

    const result = await updateStageRotting(adminActor(admin), pipelineId, body.data, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ stages: result.stages });
  } catch (error) {
    return toErrorResponse(error);
  }
}
