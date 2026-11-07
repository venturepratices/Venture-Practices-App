import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { searchParamsRecord } from "@/lib/sales/http";
import { loadLeadRows } from "@/lib/sales/leads-page";
import { parseLeadsQuery } from "@/lib/sales/leads-query";

/**
 * One page of the Leads Inbox, for "Show more": the same scope and search as
 * the page URL, continuing after `cursor`. A malformed cursor is ignored and
 * the first page comes back.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireSalesUser();
    const query = parseLeadsQuery(searchParamsRecord(request));
    return NextResponse.json(await loadLeadRows(actor, query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
