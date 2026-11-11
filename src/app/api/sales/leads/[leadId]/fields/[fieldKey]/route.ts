import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { dealFieldSchema } from "@/lib/sales/deals";
import { failResponse, readJson } from "@/lib/sales/http";
import { setLeadField } from "@/lib/sales/leads";

type Context = { params: Promise<{ leadId: string; fieldKey: string }> };

/** Set (`{ value: "..." }`) or clear (`{ value: null }`) one custom field on a lead. Answers with the stored value. */
export async function PUT(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { leadId, fieldKey } = await params;

    // The same body as a deal's field: the typed text, or null to clear it.
    const body = await readJson(request, dealFieldSchema);
    if (!body.ok) return failResponse(body);

    const result = await setLeadField(actor, leadId, fieldKey, body.data.value, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ value: result.value });
  } catch (error) {
    return toErrorResponse(error);
  }
}
