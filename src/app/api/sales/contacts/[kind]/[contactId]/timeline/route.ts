import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { CONTACT_NOT_FOUND } from "@/lib/sales/contact-access";
import { contactKindFromPath } from "@/lib/sales/contacts-query";
import { fail, failResponse } from "@/lib/sales/http";
import { loadContactTimeline, readTimelineCursor } from "@/lib/sales/timeline";

type Context = { params: Promise<{ kind: string; contactId: string }> };

/**
 * One page of a person's or an organization's History, newest first, with the
 * rows of the contacts merged into it. A contact this person may not see is
 * "Contact not found." (404).
 */
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { kind: segment, contactId } = await params;
    const kind = contactKindFromPath(segment);
    if (!kind) return failResponse(fail(400, "Invalid input."));

    const page = await loadContactTimeline(actor, kind, contactId, readTimelineCursor(request));
    if (!page) return failResponse(fail(404, CONTACT_NOT_FOUND));
    return NextResponse.json(page);
  } catch (error) {
    return toErrorResponse(error);
  }
}
