import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { fail, failResponse } from "@/lib/sales/http";
import { LEAD_NOT_FOUND } from "@/lib/sales/lead-access";
import { loadLeadTimeline, readTimelineCursor } from "@/lib/sales/timeline";

type Context = { params: Promise<{ leadId: string }> };

/** One page of a lead's History, newest first. A lead this person may not see, or a deleted one, is "Lead not found." (404). */
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { leadId } = await params;

    const page = await loadLeadTimeline(actor, leadId, readTimelineCursor(request));
    if (!page) return failResponse(fail(404, LEAD_NOT_FOUND));
    return NextResponse.json(page);
  } catch (error) {
    return toErrorResponse(error);
  }
}
