import type { RemotePattern } from "next/dist/shared/lib/image-config";

/**
 * The remote pictures the built-in Next.js image resizer (`/_next/image`) may
 * fetch and resize. Every resize is billed and the route needs no login, so
 * this allows only our own asset uploads (security audit 2026-11-07, High 5):
 *
 * - host: our own PUBLIC assets Blob store, when `ASSETS_READ_WRITE_TOKEN` is
 *   set at build time. A read-write token looks like
 *   `vercel_blob_rw_<storeId>_<secret>`, and @vercel/blob builds each public
 *   URL as `https://<storeId>.public.blob.vercel-storage.com/<pathname>`. Only
 *   the non-secret store id is used. With no usable token (local or preview
 *   builds without the assets store), any public Blob host is allowed, still
 *   with the path and query limits below.
 * - path: `/assets/**`, the prefix every asset upload uses
 *   (`src/components/assets/new-asset-dialog.tsx`, `upload-version-dialog.tsx`).
 * - no query string, so `?x=1`, `?x=2`... cannot each buy a fresh resize.
 */
const PUBLIC_BLOB_HOST = "public.blob.vercel-storage.com";

export function assetImageRemotePatterns(assetsReadWriteToken: string | undefined): RemotePattern[] {
  return [
    {
      protocol: "https",
      hostname: assetsStoreHostname(assetsReadWriteToken) ?? `**.${PUBLIC_BLOB_HOST}`,
      port: "",
      pathname: "/assets/**",
      search: "",
    },
  ];
}

function assetsStoreHostname(token: string | undefined): string | null {
  const [vercel, blob, rw, storeId] = (token ?? "").trim().split("_");
  if (vercel !== "vercel" || blob !== "blob" || rw !== "rw") return null;
  if (!storeId || !/^[a-z0-9]+$/i.test(storeId)) return null;
  // URL parsing lowercases host names, and the matcher is case-sensitive.
  return `${storeId.toLowerCase()}.${PUBLIC_BLOB_HOST}`;
}
