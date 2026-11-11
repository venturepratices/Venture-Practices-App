import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { failResponse, readJson } from "@/lib/sales/http";
import { bulkConvertSchema, convertLeads, loadConvertTargets } from "@/lib/sales/lead-convert";

/** Where a lead can be converted to: `{ targets }`, the Sales and Consulting pipelines with their open stages. */
export async function GET() {
  try {
    await requireSalesUser();
    return NextResponse.json({ targets: await loadConvertTargets() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * The Leads Inbox bulk bar's Convert: up to 25 leads to one pipeline and stage.
 * Answers `{ results, pipeline }`, one result per lead, or one refusal for the
 * whole request.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireSalesUser();

    const body = await readJson(request, bulkConvertSchema);
    if (!body.ok) return failResponse(body);

    const result = await convertLeads(actor, body.data, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ results: result.results, pipeline: result.pipeline });
  } catch (error) {
    return toErrorResponse(error);
  }
}
