import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { fail, failResponse } from "@/lib/sales/http";
import { LEAD_NOT_FOUND } from "@/lib/sales/lead-access";
import { loadLeadPanel } from "@/lib/sales/lead-panel";

type Context = { params: Promise<{ leadId: string }> };

/** The lead panel. A lead this person may not see, or a deleted one, is "Lead not found." (404). */
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { leadId } = await params;

    const panel = await loadLeadPanel(actor, leadId);
    if (!panel) return failResponse(fail(404, LEAD_NOT_FOUND));
    return NextResponse.json(panel);
  } catch (error) {
    return toErrorResponse(error);
  }
}
