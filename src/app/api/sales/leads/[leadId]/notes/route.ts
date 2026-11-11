import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";
import { addLeadNote, noteSchema } from "@/lib/sales/notes";

type Context = { params: Promise<{ leadId: string }> };

/** Add a plain-text note to an open lead (`{ body }`). Answers 201 `{ note }`. */
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { leadId } = await params;

    const body = await readJson(request, noteSchema);
    if (!body.ok) return failResponse(body);

    const result = await addLeadNote(actor, leadId, body.data, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ note: result.note }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
