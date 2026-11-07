import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson, searchParamsRecord } from "@/lib/sales/http";
import { createLead, createLeadSchema } from "@/lib/sales/leads";
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

/** New lead: the lead, its first activity, its Practice ZIP and any new organization or person (201 `{ lead: { id } }`). */
export async function POST(request: Request) {
  try {
    const actor = await requireSalesUser();

    const body = await readJson(request, createLeadSchema);
    if (!body.ok) return failResponse(body);

    const result = await createLead(actor, body.data, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ lead: result.lead }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
