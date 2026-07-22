import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { ALLOWED_UPLOAD_MIME_TYPES } from "@/lib/asset-kind";
import { requireCapability, requireClientAccess, toErrorResponse } from "@/lib/permissions";

export const runtime = "nodejs";

/**
 * Vercel Blob browser-upload token endpoint. The client (`upload()` from
 * `@vercel/blob/client`) calls here twice: once to get a short-lived token
 * before the upload, once to notify us when the upload completes. We only
 * generate a token if the caller has upload access to the target client.
 *
 * We deliberately do NOT create the DB row from `onUploadCompleted` — that
 * webhook fires only in production (Vercel Blob can't reach `localhost`), so
 * doing the DB write here would silently fail in dev. Instead the client POSTs
 * the returned blob URL to `/api/clients/[clientId]/assets` after upload to
 * create the Asset + first AssetVersion in one round-trip.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  // Assets live in their own dedicated PUBLIC Blob store (so uploaded images/
  // videos/PDFs are viewable by URL for the in-app viewer and client share
  // links) — separate from the PRIVATE store used for DB backups/archive.
  // Its read-write token is provisioned under the ASSETS_ env prefix. Fall back
  // to the default BLOB_READ_WRITE_TOKEN so this still works if only one store
  // is configured (e.g. a preview env before the assets store is attached).
  const assetsToken = process.env.ASSETS_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;

  try {
    const jsonResponse = await handleUpload({
      token: assetsToken,
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const payload = clientPayload ? (JSON.parse(clientPayload) as { clientId?: string }) : {};
        if (!payload.clientId || typeof payload.clientId !== "string") {
          throw new Error("clientId is required in clientPayload");
        }
        await requireClientAccess(payload.clientId);
        await requireCapability("canUploadAssets");
        return {
          allowedContentTypes: ALLOWED_UPLOAD_MIME_TYPES,
          // 500 MB per upload — comfortable ceiling for prototype-scale video assets.
          maximumSizeInBytes: 500 * 1024 * 1024,
          tokenPayload: clientPayload ?? undefined,
        };
      },
      onUploadCompleted: async () => {
        // Intentionally a no-op — see the docstring above. DB write happens on
        // the follow-up POST to /api/clients/[clientId]/assets.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    // Auth failures thrown by require* helpers → structured 401/403.
    if (error && typeof error === "object" && "status" in error) {
      return toErrorResponse(error);
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
