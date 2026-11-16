import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesActor } from "@/lib/sales/actor";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";
import { editNote, noteSchema } from "@/lib/sales/notes";

type Context = { params: Promise<{ noteId: string }> };

/** Replace a note's text (`{ body }`): its author or an admin only. The old text stays in the deal's history. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesActor(request, null);
    const { noteId } = await params;

    const body = await readJson(request, noteSchema);
    if (!body.ok) return failResponse(body);

    const result = await editNote(actor, noteId, body.data, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
