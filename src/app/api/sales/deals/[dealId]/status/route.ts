import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";
import { setDealStatus, statusSchema } from "@/lib/sales/stage-moves";

type Context = { params: Promise<{ dealId: string }> };

/** Mark a deal won (`{ status: "WON" }`), lost (with `lostReason` and an optional `lostComment`), or open again. */
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { dealId } = await params;

    const body = await readJson(request, statusSchema);
    if (!body.ok) return failResponse(body);

    const result = await setDealStatus(actor, dealId, body.data, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
