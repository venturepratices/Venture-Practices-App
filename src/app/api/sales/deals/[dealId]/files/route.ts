import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { FILE_MAX_BYTES, FORM_OVERHEAD_BYTES } from "@/lib/sales/constants";
import { FILE_TOO_BIG, uploadDealFile } from "@/lib/sales/files";
import { assertSameOrigin, fail, failResponse, type SalesFail } from "@/lib/sales/http";

// The File tab's upload: a multipart form with `file` and `confirmedFinal`
// ("true"), stored by the server in the private Blob store (files.ts). No
// client upload token: the browser posts the bytes here, so a file is at most
// 4 MB (Vercel's request body limit). Node, for the crypto hash and the SDK.
export const runtime = "nodejs";

type Context = { params: Promise<{ dealId: string }> };

/** The most bytes a form may carry: the file plus room for its multipart wrapping. */
const BODY_CAP = FILE_MAX_BYTES + FORM_OVERHEAD_BYTES;
const CHOOSE_FILE = "Choose a file first.";

/**
 * The request's form, read with a byte counter that stops (and cancels the
 * body) once it passes the cap, so a body with no `Content-Length`, or one
 * that lies about it, is never read in full. `request.formData()` is never
 * called: it would read everything first.
 */
async function readForm(request: Request): Promise<{ ok: true; form: FormData } | SalesFail> {
  const declared = Number(request.headers.get("content-length"));
  if (request.headers.has("content-length") && Number.isFinite(declared) && declared > BODY_CAP) {
    return fail(413, FILE_TOO_BIG);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BODY_CAP) {
        await reader.cancel().catch(() => undefined);
        return fail(413, FILE_TOO_BIG);
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const form = await new Response(bytes, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    return { ok: true, form };
  } catch {
    // Not a form at all: there is no file in it to add.
    return fail(400, CHOOSE_FILE);
  }
}

/** Add a final-version file to a deal (owner or admin). Answers 201 `{ file }`. */
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);
    const { dealId } = await params;

    const read = await readForm(request);
    if (!read.ok) return failResponse(read);
    const entry = read.form.get("file");
    // A form sent with no file picked carries the field as an empty string.
    if (entry === null || typeof entry === "string" || entry.size === 0) return failResponse(fail(400, CHOOSE_FILE));
    if (entry.size > FILE_MAX_BYTES) return failResponse(fail(413, FILE_TOO_BIG));

    const result = await uploadDealFile(
      actor,
      dealId,
      {
        name: entry.name,
        bytes: new Uint8Array(await entry.arrayBuffer()),
        confirmedFinal: read.form.get("confirmedFinal") === "true",
      },
      requestMeta(request),
      new Date(),
    );
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ file: result.file }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
