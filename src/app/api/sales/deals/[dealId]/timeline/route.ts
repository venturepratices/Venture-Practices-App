import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { chargeBotRows, requireSalesActor } from "@/lib/sales/actor";
import { DEAL_NOT_FOUND } from "@/lib/sales/deal-access";
import { fail, failResponse } from "@/lib/sales/http";
import { loadDealTimeline, readTimelineCursor } from "@/lib/sales/timeline";

type Context = { params: Promise<{ dealId: string }> };

/** One page of a deal's History, newest first. A deal this person may not see is "Deal not found." (404). */
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesActor(request, "read");
    const { dealId } = await params;

    const page = await loadDealTimeline(actor, dealId, readTimelineCursor(request));
    if (!page) return failResponse(fail(404, DEAL_NOT_FOUND));
    await chargeBotRows(actor, page.entries.length);
    return NextResponse.json(page);
  } catch (error) {
    return toErrorResponse(error);
  }
}
