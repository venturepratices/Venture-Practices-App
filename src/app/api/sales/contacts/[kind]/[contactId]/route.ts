import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { CONTACT_NOT_FOUND } from "@/lib/sales/contact-access";
import { loadContactPanel } from "@/lib/sales/contact-panel";
import { contactKindFromPath } from "@/lib/sales/contacts-query";
import { fail, failResponse } from "@/lib/sales/http";

type Context = { params: Promise<{ kind: string; contactId: string }> };

/**
 * The contact panel for `people/<id>` or `organizations/<id>`. A contact this
 * person may not see, or an archived one, is "Contact not found." (404); an old
 * link to a merged contact answers with the contact it was merged into.
 */
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { kind: segment, contactId } = await params;
    const kind = contactKindFromPath(segment);
    if (!kind) return failResponse(fail(400, "Invalid input."));

    const panel = await loadContactPanel(actor, kind, contactId);
    if (!panel) return failResponse(fail(404, CONTACT_NOT_FOUND));
    return NextResponse.json(panel);
  } catch (error) {
    return toErrorResponse(error);
  }
}
