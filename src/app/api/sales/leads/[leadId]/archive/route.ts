import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesActor } from "@/lib/sales/actor";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";
import { leadArchiveSchema, setLeadArchived } from "@/lib/sales/leads";

type Context = { params: Promise<{ leadId: string }> };

/** Archive (`{ archived: true }`) or restore (`{ archived: false }`) a lead. `changed` is false when it already was. */
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesActor(request, null);
    const { leadId } = await params;

    const body = await readJson(request, leadArchiveSchema);
    if (!body.ok) return failResponse(body);

    const result = await setLeadArchived(actor, leadId, body.data.archived, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ ok: true, changed: result.changed });
  } catch (error) {
    return toErrorResponse(error);
  }
}
