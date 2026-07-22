import { AssetKind } from "@/generated/prisma/enums";

/**
 * Map a file's MIME type to our AssetKind bucket. Called both server-side (when
 * persisting a new version) and client-side (when picking icons before upload).
 * WEBSITE isn't derivable from a MIME type — it's set explicitly when the user
 * pastes a URL instead of uploading a file.
 */
export function assetKindFromMimeType(mimeType: string | null | undefined): AssetKind {
  if (!mimeType) return AssetKind.OTHER;
  if (mimeType.startsWith("image/")) return AssetKind.IMAGE;
  if (mimeType.startsWith("video/")) return AssetKind.VIDEO;
  if (mimeType === "application/pdf") return AssetKind.PDF;
  return AssetKind.OTHER;
}

/** MIME-type allowlist for the Blob upload token endpoint. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  "image/*",
  "video/*",
  "application/pdf",
  // Design source files land in OTHER — download-only in the prototype viewer.
  "application/postscript", // .ai / .eps
  "application/octet-stream", // some browsers report .psd this way
  "image/vnd.adobe.photoshop", // .psd
];
