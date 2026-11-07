import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { createOrganization, createOrganizationSchema, createPerson, createPersonSchema } from "@/lib/sales/contacts-edit";
import { loadContactRows } from "@/lib/sales/contacts-page";
import { CONTACT_PATHS, contactKindFromPath, parseContactsQuery } from "@/lib/sales/contacts-query";
import { fail, failResponse, readJson, searchParamsRecord } from "@/lib/sales/http";

type Context = { params: Promise<{ kind: string }> };

/**
 * One page of the Contacts list, for "Show more": `people` or `organizations`
 * (anything else is "Invalid input."), with the same scope and search as the
 * page URL, continuing after `cursor`. The list comes from the path, never from
 * a `tab` param. A malformed cursor is ignored and the first page comes back.
 */
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const kind = contactKindFromPath((await params).kind);
    if (!kind) return failResponse(fail(400, "Invalid input."));

    const query = parseContactsQuery({ ...searchParamsRecord(request), tab: CONTACT_PATHS[kind] });
    return NextResponse.json(await loadContactRows(actor, query));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * "+ Person" or "+ Organization": adds a contact owned by the person adding it
 * (201 `{ contact: { id, name } }`). `people` takes a name, email, phone, role
 * and organization; `organizations` a name, phone, website, address and ZIP.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const kind = contactKindFromPath((await params).kind);
    if (!kind) return failResponse(fail(400, "Invalid input."));

    if (kind === "person") {
      const body = await readJson(request, createPersonSchema);
      if (!body.ok) return failResponse(body);
      const result = await createPerson(actor, body.data, requestMeta(request));
      if (!result.ok) return failResponse(result);
      return NextResponse.json({ contact: result.contact }, { status: 201 });
    }

    const body = await readJson(request, createOrganizationSchema);
    if (!body.ok) return failResponse(body);
    const result = await createOrganization(actor, body.data, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ contact: result.contact }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
