import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { dealFieldSchema, setDealField } from "@/lib/sales/deals";
import { failResponse, readJson } from "@/lib/sales/http";

type Context = { params: Promise<{ dealId: string; fieldKey: string }> };

/** Set (`{ value: "..." }`) or clear (`{ value: null }`) one custom field on a deal. Answers with the stored value. */
export async function PUT(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { dealId, fieldKey } = await params;

    const body = await readJson(request, dealFieldSchema);
    if (!body.ok) return failResponse(body);

    const result = await setDealField(actor, dealId, fieldKey, body.data.value, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ value: result.value });
  } catch (error) {
    return toErrorResponse(error);
  }
}
