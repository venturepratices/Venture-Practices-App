import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/permissions";
import { requireSalesUser } from "@/lib/sales/access";
import { requestMeta } from "@/lib/sales/audit";
import { contentDisposition } from "@/lib/sales/file-rules";
import {
  FILE_NOT_FOUND,
  FILE_STORAGE_MISSING,
  fileStorageReady,
  findFileForDownload,
  removeDealFile,
} from "@/lib/sales/files";
import { assertSameOrigin, fail, failResponse } from "@/lib/sales/http";

type Context = { params: Promise<{ fileId: string }> };

/**
 * Download a deal's file: the only way to its bytes (the store is private and
 * no link to it ever leaves the server). The deal's who-can-see check runs on
 * every request; a removed file, a hidden or deleted deal, or a stored path
 * outside `sales-files/` is "File not found." Always an attachment, never shown
 * in the page, never sniffed, never cached, and sandboxed if opened anyway.
 */
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const { fileId } = await params;

    const file = await findFileForDownload(actor, fileId);
    if (!file) return failResponse(fail(404, FILE_NOT_FOUND));
    if (!fileStorageReady()) return failResponse(fail(503, FILE_STORAGE_MISSING));

    const stored = await get(file.blobPathname, { access: "private" });
    if (!stored || stored.statusCode !== 200) return failResponse(fail(404, FILE_NOT_FOUND));

    return new Response(stored.stream, {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-disposition": contentDisposition(file.name),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        "content-security-policy": "sandbox",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Remove a file from its deal's Files list (owner or admin). The stored bytes stay. Answers `{ ok, changed }`. */
export async function DELETE(request: Request, { params }: Context) {
  try {
    const actor = await requireSalesUser();
    const blocked = assertSameOrigin(request);
    if (blocked) return failResponse(blocked);
    const { fileId } = await params;

    const result = await removeDealFile(actor, fileId, requestMeta(request), new Date());
    if (!result.ok) return failResponse(result);
    return NextResponse.json({ ok: true, changed: result.changed });
  } catch (error) {
    return toErrorResponse(error);
  }
}
