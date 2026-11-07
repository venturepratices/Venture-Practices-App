import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { DEAL_NOT_FOUND } from "@/lib/sales/deal-access";
import { fail, failResponse } from "@/lib/sales/http";
import { loadDealTimeline, readTimelineCursor } from "@/lib/sales/timeline";

type Context = { params: Promise<{ dealId: string }> };

/** One page of a deal's History, newest first. A deal this person may not see is "Deal not found." (404). */
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { dealId } = await params;

    const page = await loadDealTimeline(actor, dealId, readTimelineCursor(request));
    if (!page) return failResponse(fail(404, DEAL_NOT_FOUND));
    return NextResponse.json(page);
  } catch (error) {
    return toErrorResponse(error);
  }
}
