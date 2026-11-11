import { NextResponse } from "next/server";
import { z } from "zod";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { savedViewsSchema } from "@/lib/sales/board-query";
import { failResponse, readJson } from "@/lib/sales/http";
import { saveSavedViews } from "@/lib/sales/view-preference";

const bodySchema = z.strictObject({ views: savedViewsSchema });

/**
 * Replaces this person's saved Deals views (the Views menu: up to 20, names
 * unique ignoring case) and answers with the list as stored, names trimmed.
 * A preference, not Sales data: no history row (Decision 29).
 */
export async function PUT(request: Request) {
  try {
    const actor = await requireSalesUser();

    const body = await readJson(request, bodySchema);
    if (!body.ok) return failResponse(body);

    await saveSavedViews(actor.userId, body.data.views);
    return NextResponse.json({ views: body.data.views });
  } catch (error) {
    return toErrorResponse(error);
  }
}
