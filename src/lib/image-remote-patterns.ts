import type { RemotePattern } from "next/dist/shared/lib/image-config";

/**
 * The remote pictures the built-in Next.js image resizer (`/_next/image`) may
 * fetch and resize. Every resize is billed and the route needs no login, so
 * this allows only our own asset uploads (security audit 2026-11-07, High 5):
 *
 * - host: our own PUBLIC assets Blob store. The store id comes, at build time,
 *   from `ASSETS_READ_WRITE_TOKEN` (`vercel_blob_rw_<storeId>_<secret>`, only
 *   the non-secret store id is used) or else from `ASSETS_STORE_ID`
 *   (`store_<storeId>`). @vercel/blob builds each public URL as
 *   `https://<storeId>.public.blob.vercel-storage.com/<pathname>`.
 *   With no usable store id:
 *   - a production build (`VERCEL_ENV=production`) fails, because allowing any
 *     Blob store would let anyone upload `/assets/1.png`, `/assets/2.png`... to
 *     their own free store and bill us a new resize for each;
 *   - any other build on Vercel (Preview) allows no remote pictures at all, so
 *     its asset thumbnails show as broken images;
 *   - a local build allows any public Blob host, still with the limits below.
 * - path: `/assets/**`, the prefix every asset upload uses
 *   (`src/components/assets/new-asset-dialog.tsx`, `upload-version-dialog.tsx`).
 * - no query string, so `?x=1`, `?x=2`... cannot each buy a fresh resize.
 */
const PUBLIC_BLOB_HOST = "public.blob.vercel-storage.com";

/** The build-time environment variables this reads (pass `process.env`). */
export type AssetImageEnv = {
  [name: string]: string | undefined;
  ASSETS_READ_WRITE_TOKEN?: string;
  ASSETS_STORE_ID?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
};

export function assetImageRemotePatterns(env: AssetImageEnv): RemotePattern[] {
  const storeId = storeIdFromToken(env.ASSETS_READ_WRITE_TOKEN) ?? storeIdFromStoreIdVar(env.ASSETS_STORE_ID);
  if (storeId) return [assetsPattern(`${storeId}.${PUBLIC_BLOB_HOST}`)];

  if (env.VERCEL_ENV === "production") {
    // Never include the variables' values here: build logs are widely readable.
    throw new Error(
      "Production build stopped: set ASSETS_READ_WRITE_TOKEN (vercel_blob_rw_<storeId>_...) or " +
        "ASSETS_STORE_ID (store_<storeId>) for the assets Blob store, then redeploy. Without a store id " +
        "the image resizer (/_next/image) would resize pictures from any public Blob store, billed to us. " +
        "See src/lib/image-remote-patterns.ts.",
    );
  }
  if (env.VERCEL === "1") return [];
  return [assetsPattern(`**.${PUBLIC_BLOB_HOST}`)];
}

function assetsPattern(hostname: string): RemotePattern {
  return { protocol: "https", hostname, port: "", pathname: "/assets/**", search: "" };
}

function storeIdFromToken(token: string | undefined): string | null {
  const [vercel, blob, rw, storeId] = (token ?? "").trim().split("_");
  if (vercel !== "vercel" || blob !== "blob" || rw !== "rw") return null;
  return usableStoreId(storeId);
}

function storeIdFromStoreIdVar(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return usableStoreId(trimmed.startsWith("store_") ? trimmed.slice("store_".length) : trimmed);
}

function usableStoreId(storeId: string | undefined): string | null {
  if (!storeId || !/^[a-z0-9]+$/i.test(storeId)) return null;
  // URL parsing lowercases host names, and the matcher is case-sensitive.
  return storeId.toLowerCase();
}
