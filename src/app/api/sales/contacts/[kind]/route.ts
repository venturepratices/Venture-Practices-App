import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { loadContactRows } from "@/lib/sales/contacts-page";
import { CONTACT_PATHS, contactKindFromPath, parseContactsQuery } from "@/lib/sales/contacts-query";
import { fail, failResponse, searchParamsRecord } from "@/lib/sales/http";

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
