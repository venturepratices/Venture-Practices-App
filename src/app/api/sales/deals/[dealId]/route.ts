import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { DEAL_NOT_FOUND } from "@/lib/sales/deal-access";
import { loadDealPanel } from "@/lib/sales/deal-panel";
import { fail, failResponse } from "@/lib/sales/http";

type Context = { params: Promise<{ dealId: string }> };

/** The deal panel. A deal this person may not see, or an archived one, is "Deal not found." (404). */
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { dealId } = await params;

    const panel = await loadDealPanel(actor, dealId);
    if (!panel) return failResponse(fail(404, DEAL_NOT_FOUND));
    return NextResponse.json(panel);
  } catch (error) {
    return toErrorResponse(error);
  }
}
