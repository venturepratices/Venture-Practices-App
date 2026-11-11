import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";
import { convertLead, convertLeadSchema } from "@/lib/sales/lead-convert";

type Context = { params: Promise<{ leadId: string }> };

/** Convert one lead to a deal (201 `{ deal: { id, pipelineKey, pipelineName } }`). */
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { leadId } = await params;

    const body = await readJson(request, convertLeadSchema);
    if (!body.ok) return failResponse(body);

    const result = await convertLead(actor, leadId, body.data, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ deal: result.deal }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
