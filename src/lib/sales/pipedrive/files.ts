// Copies ONE Pipedrive file into the app's private Blob store, the way the app's
// own upload does (src/lib/sales/files.ts): the type comes from the bytes, never
// from the name; the stored name is made by the server; the row goes in with the
// stored copy's pathname, its size, its SHA-256 and the Pipedrive add time.
//
// Rules, in order: the listed size (over 4 MB is refused without a download),
// the store's credentials, the download, the real size and the real type. A
// refused file is never stored. Daily upload quotas do not apply to an import.
//
// The store is reached only through the credential the Blob SDK reads by itself;
// no `token` option is ever passed. A file's name never goes into a thrown error
// or a log line: every failure after the bytes arrive is caught and answered with
// a fixed reason. The one error this lets through is a Pipedrive rate limit (429),
// which carries no file name, so the run can pause instead of failing every file.
//
// Safe to run again: the caller skips a file whose `pipedriveId` already has a
// row, and a row written a moment earlier by another request (the unique Pipedrive
// id refuses a second one) counts as copied.

import { createHash, randomUUID } from "node:crypto";

import { del, put } from "@vercel/blob";

import { prisma } from "@/lib/prisma";
import { isPrismaError } from "@/lib/prisma-errors";
import { FILE_MAX_BYTES, FILE_PATH_PREFIX } from "@/lib/sales/constants";
import { cleanFileName, FILE_TYPES, sniffFileType } from "@/lib/sales/file-rules";
import { fileStorageReady } from "@/lib/sales/files";
import { PipedriveError, type PipedriveClient } from "@/lib/sales/pipedrive/client";

export type CopyFileFailure = "too-big" | "unsupported-type" | "no-storage" | "download-failed" | "save-failed";

export type CopyFileResult = { ok: true } | { ok: false; reason: CopyFileFailure };

// Fixed log lines: no error text, since a database or store error can quote the file's name.
const LOG_PUT_FAILED = "Pipedrive file copy: the file store refused an upload.";
const LOG_SAVE_FAILED = "Pipedrive file copy: saving a copied file's record failed; removing the stored copy.";
const LOG_CLEANUP_FAILED = "Pipedrive file copy: could not remove a stored copy after a failed save.";

const refused = (reason: CopyFileFailure): CopyFileResult => ({ ok: false, reason });

/** Best effort: a stored copy whose row was never saved. A failure here is logged, never thrown. */
async function removeStoredCopy(pathname: string): Promise<void> {
  try {
    await del(pathname);
  } catch {
    console.error(LOG_CLEANUP_FAILED);
  }
}

/**
 * Downloads one Pipedrive file and stores it on a deal or a lead.
 *
 * `file.dealId` and `file.leadId` are the APP's row ids (not Pipedrive's), one of
 * them set. `file.size` is the size Pipedrive lists (0 when it lists none; the
 * real bytes are checked again after the download). `addedAt` becomes
 * `finalConfirmedAt`, `uploadedById` the uploader, `stageName` the deal's stage now.
 */
export async function copyPipedriveFile(args: {
  client: PipedriveClient;
  file: { id: number; name: string; dealId: string | null; leadId: string | null; size: number };
  uploadedById: string;
  stageName: string | null;
  addedAt: Date;
}): Promise<CopyFileResult> {
  const { client, file, uploadedById, stageName, addedAt } = args;

  if (file.size > FILE_MAX_BYTES) return refused("too-big");
  if (!fileStorageReady()) return refused("no-storage");

  let bytes: Uint8Array;
  try {
    bytes = (await client.download(`/v1/files/${file.id}/download`)).bytes;
  } catch (error) {
    // The client's rate-limit error names no file. It stops the run (paused), not just this file.
    if (error instanceof PipedriveError && error.status === 429) throw error;
    return refused("download-failed");
  }
  if (bytes.byteLength === 0) return refused("download-failed");
  // The listed size can be wrong, so the real one decides too.
  if (bytes.byteLength > FILE_MAX_BYTES) return refused("too-big");

  const typeKey = sniffFileType(bytes);
  if (!typeKey) return refused("unsupported-type");
  const type = FILE_TYPES[typeKey];

  const pathname = `${FILE_PATH_PREFIX}${randomUUID()}.${type.ext}`;
  try {
    await put(pathname, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: type.contentType,
    });
  } catch {
    console.error(LOG_PUT_FAILED);
    return refused("save-failed");
  }

  try {
    await prisma.salesFile.create({
      data: {
        name: cleanFileName(file.name, type.ext),
        blobPathname: pathname,
        contentType: type.contentType,
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        uploadedById,
        dealId: file.dealId,
        leadId: file.leadId,
        finalConfirmedAt: addedAt,
        stageName,
        pipedriveId: file.id,
      },
      select: { id: true },
    });
  } catch (error) {
    const alreadyCopied = isPrismaError(error, "P2002");
    if (!alreadyCopied) console.error(LOG_SAVE_FAILED);
    await removeStoredCopy(pathname);
    return alreadyCopied ? { ok: true } : refused("save-failed");
  }
  return { ok: true };
}
