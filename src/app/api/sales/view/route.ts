import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { savedViewSchema } from "@/lib/sales/board-query";
import { failResponse, readJson } from "@/lib/sales/http";
import { saveDefaultView } from "@/lib/sales/view-preference";

/**
 * Remembers this person's Deals view (pipeline, Board or List, Everyone or
 * Just me). A preference, not Sales data: no history row (Decision 13).
 */
export async function PUT(request: Request) {
  try {
    const actor = await requireSalesUser();

    const body = await readJson(request, savedViewSchema);
    if (!body.ok) return failResponse(body);

    await saveDefaultView(actor.userId, body.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
