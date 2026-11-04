import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";
import { moveDealSchema, moveDealStage } from "@/lib/sales/stage-moves";

type Context = { params: Promise<{ dealId: string }> };

/**
 * Move a deal to another stage (`{ stageId }`, plus `valueCents`/`mrrCents` from
 * the value dialog, or `undoActivityIds` when undoing). Answers with the move,
 * or 422 with `code: "PROPOSAL_NEEDS_VALUE"` so the screen opens the value dialog.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { dealId } = await params;

    const body = await readJson(request, moveDealSchema);
    if (!body.ok) return failResponse(body);

    const result = await moveDealStage(actor, dealId, body.data, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
