import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { loadDealListPage } from "@/lib/sales/board";
import { parseBoardQuery } from "@/lib/sales/board-query";
import { createDeal, createDealSchema } from "@/lib/sales/deals";
import { failResponse, readJson, searchParamsRecord } from "@/lib/sales/http";

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

/** Add deal: the deal, its first activity and any new organization or person (201 `{ deal: { id, pipelineKey } }`). */
export async function POST(request: Request) {
  try {
    const actor = await requireSalesUser();

    const body = await readJson(request, createDealSchema);
    if (!body.ok) return failResponse(body);

    const result = await createDeal(actor, body.data, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ deal: result.deal }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
