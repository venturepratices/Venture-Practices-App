import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { DEAL_NOT_FOUND } from "@/lib/sales/deal-access";
import { fail, failResponse } from "@/lib/sales/http";
import { loadDealTimeline, type TimelineCursor } from "@/lib/sales/timeline";

type Context = { params: Promise<{ dealId: string }> };

const CURSOR_ID_MAX = 64;

/** `?at=<iso>&id=<id>` from "Show older". Anything unreadable means the first page, never an error. */
function readCursor(request: Request): TimelineCursor | null {
  const search = new URL(request.url).searchParams;
  const at = search.get("at");
  const id = search.get("id");
  if (!at || !id || id.length > CURSOR_ID_MAX) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : { at: new Date(ms).toISOString(), id };
}

/** One page of a deal's History, newest first. A deal this person may not see is "Deal not found." (404). */
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { dealId } = await params;

    const page = await loadDealTimeline(actor, dealId, readCursor(request));
    if (!page) return failResponse(fail(404, DEAL_NOT_FOUND));
    return NextResponse.json(page);
  } catch (error) {
    return toErrorResponse(error);
  }
}
