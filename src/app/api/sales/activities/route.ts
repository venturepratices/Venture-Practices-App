import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { loadActivityRows } from "@/lib/sales/activities-page";
import { parseActivitiesQuery } from "@/lib/sales/activities-query";
import { searchParamsRecord } from "@/lib/sales/http";

/**
 * One page of the Activities list, for "Show more": the same filters as the
 * page URL, continuing after `cursor`. A malformed cursor is ignored and the
 * first page comes back.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireSalesUser();
    const query = parseActivitiesQuery(searchParamsRecord(request));
    return NextResponse.json(await loadActivityRows(actor, query, new Date()));
  } catch (error) {
    return toErrorResponse(error);
  }
}
