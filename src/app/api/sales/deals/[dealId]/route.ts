import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { DEAL_NOT_FOUND } from "@/lib/sales/deal-access";
import { loadDealPanel } from "@/lib/sales/deal-panel";
import { archiveDeal, updateDeal, updateDealSchema } from "@/lib/sales/deals";
import { assertSameOrigin, fail, failResponse, readJson } from "@/lib/sales/http";

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

/** Rename, set the source or values, or change the owner. Answers with the saved fields. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { dealId } = await params;

    const body = await readJson(request, updateDealSchema);
    if (!body.ok) return failResponse(body);

    const result = await updateDeal(actor, dealId, body.data, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ deal: result.deal });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Delete (archive) a deal: admins only. A refused attempt is recorded in the deal's history. */
export async function DELETE(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);
    const { dealId } = await params;

    const result = await archiveDeal(actor, dealId, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
