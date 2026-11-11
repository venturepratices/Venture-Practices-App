import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";
import { bulkLeadSchema, runLeadBulk } from "@/lib/sales/lead-bulk";

/**
 * The Leads Inbox bulk bar: assign, archive, restore or delete up to 100 leads.
 * Answers `{ results }`, one per lead, or one refusal for the whole request.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireSalesUser();

    const body = await readJson(request, bulkLeadSchema);
    if (!body.ok) return failResponse(body);

    const result = await runLeadBulk(actor, body.data, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ results: result.results });
  } catch (error) {
    return toErrorResponse(error);
  }
}
