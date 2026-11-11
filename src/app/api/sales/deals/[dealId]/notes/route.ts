import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";
import { addDealNote, noteSchema } from "@/lib/sales/notes";

type Context = { params: Promise<{ dealId: string }> };

/** Add a plain-text note to a deal (`{ body }`). Answers 201 `{ note }`. */
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { dealId } = await params;

    const body = await readJson(request, noteSchema);
    if (!body.ok) return failResponse(body);

    const result = await addDealNote(actor, dealId, body.data, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ note: result.note }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
