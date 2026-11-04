import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { loadDealListPage } from "@/lib/sales/board";
import { parseBoardQuery } from "@/lib/sales/board-query";
import { searchParamsRecord } from "@/lib/sales/http";

/**
 * One page of the Deals list view, for "Show more": the same pipeline, scope
 * and filters as the page URL, continuing after `cursor`. Never the saved
 * view. A malformed cursor is ignored and the first page comes back.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireSalesUser();
    const query = parseBoardQuery(searchParamsRecord(request));
    const page = await loadDealListPage(actor, query, new Date());
    return NextResponse.json(page ?? { rows: [], nextCursor: null });
  } catch (error) {
    return toErrorResponse(error);
  }
}
