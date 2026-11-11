import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { CONTACT_NOT_FOUND } from "@/lib/sales/contact-access";
import { loadContactPanel } from "@/lib/sales/contact-panel";
import { updateOrganization, updateOrganizationSchema, updatePerson, updatePersonSchema } from "@/lib/sales/contacts-edit";
import { contactKindFromPath } from "@/lib/sales/contacts-query";
import { fail, failResponse, readJson } from "@/lib/sales/http";

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

/**
 * Edits a person or an organization (its owner or an admin). Only the keys sent
 * change; answers `{ changed, contact: { id, name } }`, with `changed: false`
 * when the contact already read that way. A save that lands a moment after
 * another one is "This contact just changed. Refresh and try again." (409).
 */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { kind: segment, contactId } = await params;
    const kind = contactKindFromPath(segment);
    if (!kind) return failResponse(fail(400, "Invalid input."));

    if (kind === "person") {
      const body = await readJson(request, updatePersonSchema);
      if (!body.ok) return failResponse(body);
      const result = await updatePerson(actor, contactId, body.data, requestMeta(request));
      if (!result.ok) return failResponse(result);
      return NextResponse.json({ changed: result.changed, contact: result.contact });
    }

    const body = await readJson(request, updateOrganizationSchema);
    if (!body.ok) return failResponse(body);
    const result = await updateOrganization(actor, contactId, body.data, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ changed: result.changed, contact: result.contact });
  } catch (error) {
    return toErrorResponse(error);
  }
}
