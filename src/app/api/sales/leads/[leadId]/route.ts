import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { assertSameOrigin, fail, failResponse, readJson } from "@/lib/sales/http";
import { LEAD_NOT_FOUND } from "@/lib/sales/lead-access";
import { loadLeadPanel } from "@/lib/sales/lead-panel";
import { deleteLead, updateLead, updateLeadSchema } from "@/lib/sales/leads";

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

/** Rename, set the source, change the owner, or change the organization and person. Answers with the saved fields. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { leadId } = await params;

    const body = await readJson(request, updateLeadSchema);
    if (!body.ok) return failResponse(body);

    const result = await updateLead(actor, leadId, body.data, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ lead: result.lead });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Delete a lead: admins only. A refused attempt is recorded in the lead's history. */
export async function DELETE(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);
    const { leadId } = await params;

    const result = await deleteLead(actor, leadId, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
