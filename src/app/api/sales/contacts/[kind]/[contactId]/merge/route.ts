import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { loadMergePreview, mergeBodySchema, mergeContacts } from "@/lib/sales/contact-merge";
import { contactKindFromPath } from "@/lib/sales/contacts-query";
import { fail, failResponse, readJson } from "@/lib/sales/http";

type Context = { params: Promise<{ kind: string; contactId: string }> };

const INVALID_INPUT = "Invalid input.";

/**
 * What merging `?with=<id>` into `people/<id>` or `organizations/<id>` would
 * move, for the confirm dialog: `{ keep, drop, counts }`. Admins only ("Only an
 * admin can merge contacts.", 403), since the counts span every rep's records.
 */
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { kind: segment, contactId } = await params;
    const kind = contactKindFromPath(segment);
    const dropId = mergeBodySchema.shape.dropId.safeParse(new URL(request.url).searchParams.get("with"));
    if (!kind || !dropId.success) return failResponse(fail(400, INVALID_INPUT));

    const preview = await loadMergePreview(actor, kind, contactId, dropId.data);
    if (!preview.ok) return failResponse(preview);
    return NextResponse.json({ keep: preview.keep, drop: preview.drop, counts: preview.counts });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Merges the contact in the body (`{ dropId }`) into the one the URL names
 * (admins only) and answers `{ kept: { id, name } }`. A merge that loses to a
 * change made a moment earlier, twice, is "One of these contacts just changed.
 * Refresh and try again." (409). No Undo.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const body = await readJson(request, mergeBodySchema);
    if (!body.ok) return failResponse(body);
    const { kind: segment, contactId } = await params;
    const kind = contactKindFromPath(segment);
    if (!kind) return failResponse(fail(400, INVALID_INPUT));

    const result = await mergeContacts(actor, kind, contactId, body.data.dropId, requestMeta(request));
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ kept: result.kept });
  } catch (error) {
    return toErrorResponse(error);
  }
}
