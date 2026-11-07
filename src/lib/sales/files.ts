import { createHash, randomUUID } from "node:crypto";

import { del, put } from "@vercel/blob";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canEditDeal, dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import type { SalesRequestMeta } from "@/lib/sales/audit";
import {
  FILE_BYTES_PER_PERSON_DAY,
  FILE_MAX_BYTES,
  FILE_PATH_PREFIX,
  FILES_PER_DEAL_MAX,
  FILES_PER_PERSON_DAY,
} from "@/lib/sales/constants";
import { findDealForEdit, NOT_YOUR_DEAL } from "@/lib/sales/deal-access";
import { recordDealAudit } from "@/lib/sales/deal-audit";
import { PANEL_FILE_SELECT, toPanelFile, type PanelFile } from "@/lib/sales/deal-panel";
import { cleanFileName, FILE_TYPES, isSalesFilePathname, sniffFileType } from "@/lib/sales/file-rules";
import { fail, type SalesFail } from "@/lib/sales/http";
import { dateInputValue, startOfDay } from "@/lib/utils";

// A deal's final-version files (spec rule 7, A7): the deal owner or an admin
// adds a file the client received, ticking that it is the final version; the
// server checks what the bytes really are, stores them in the PRIVATE Blob
// store under a pathname it makes, and records the row and its history in one
// transaction. Downloads go only through the app, after the deal's who-can-see
// check. Removing a file hides it (the stored bytes stay).
//
// The store is reached only through the credential the Blob SDK reads by
// itself (BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID through OIDC); no `token`
// option is ever passed. A file's name never goes into a thrown error or a log
// line, so it cannot reach Sentry: every failure after the bytes arrive is
// caught and answered with a fixed message.

type Meta = Partial<SalesRequestMeta>;

export const FILE_NOT_FOUND = "File not found.";
export const FILE_TOO_BIG = "Files can be up to 4 MB.";
export const FILE_STORAGE_MISSING = "File storage is not set up yet.";
const TICK_FINAL = "Tick the box to confirm this is the final version the client received.";
const WRONG_TYPE = "Only PDF, Word, Excel, PNG or JPG files can be added.";
const DEAL_FULL = `This deal already has ${FILES_PER_DEAL_MAX} files. Remove one first.`;
const DAY_FILES_USED = `You can add up to ${FILES_PER_PERSON_DAY} files a day. Try again tomorrow.`;
const DAY_BYTES_USED = "You can add up to 100 MB of files a day. Try again tomorrow.";
const STORE_FAILED = "Could not store the file. Try again.";

// Fixed log lines: no error text, since a database or store error can quote the file's name.
const LOG_PUT_FAILED = "Sales files: the file store refused an upload.";
const LOG_SAVE_FAILED = "Sales files: saving an uploaded file's record failed; removing the stored copy.";
const LOG_CLEANUP_FAILED = "Sales files: could not remove a stored copy after a failed save.";

/** Whether the app can reach the Blob store at all (the same check backup.ts and archive.ts make). */
function hasBlobCredentials(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

/** The deal, as the upload checks it: who owns it (the edit right) and its stage now (kept on the file). */
const UPLOAD_DEAL_SELECT = { ownerId: true, stage: { select: { name: true } } } satisfies Prisma.SalesDealSelect;

/**
 * Every check that can refuse an upload, read-only: the edit right, the deal's
 * file count and the person's app-time day. Runs once before the bytes go to
 * the store and again inside the transaction that saves the row.
 */
async function checkUpload(
  db: Prisma.TransactionClient,
  actor: SalesActor,
  dealId: string,
  sizeBytes: number,
  now: Date,
): Promise<{ ok: true; stageName: string } | SalesFail> {
  const found = await findDealForEdit(db, actor, dealId, UPLOAD_DEAL_SELECT);
  if (!found.ok) return found;

  const live = await db.salesFile.count({ where: { dealId, archivedAt: null } });
  if (live >= FILES_PER_DEAL_MAX) return fail(400, DEAL_FULL);

  // Removed files count too, so removing and adding again cannot get round the limit.
  const today = await db.salesFile.aggregate({
    where: { uploadedById: actor.userId, createdAt: { gte: startOfDay(dateInputValue(now)) } },
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });
  if (today._count._all >= FILES_PER_PERSON_DAY) return fail(400, DAY_FILES_USED);
  if ((today._sum.sizeBytes ?? 0) + sizeBytes > FILE_BYTES_PER_PERSON_DAY) return fail(400, DAY_BYTES_USED);

  return { ok: true, stageName: found.deal.stage.name };
}

/** Best effort: a stored copy whose row was never saved. A failure here is logged, never thrown. */
async function removeStoredCopy(pathname: string): Promise<void> {
  try {
    await del(pathname);
  } catch {
    console.error(LOG_CLEANUP_FAILED);
  }
}

type UploadResult = { ok: true; file: PanelFile } | SalesFail;

/**
 * Adds a final-version file to a deal. In order: the final-version tick, the
 * size, the store's credentials, what the bytes are, a read-only check of the
 * edit right and the limits, the upload to the private store, then one
 * transaction that checks again, saves the row and writes `file_added`. If
 * that transaction refuses or fails, the stored copy is removed and the answer
 * is the refusal, or 503 (never a thrown error: one could carry the name).
 */
export async function uploadDealFile(
  actor: SalesActor,
  dealId: string,
  input: { name: string; bytes: Uint8Array; confirmedFinal: boolean },
  meta: Meta,
  now: Date,
): Promise<UploadResult> {
  if (!input.confirmedFinal) return fail(400, TICK_FINAL);
  if (input.bytes.byteLength > FILE_MAX_BYTES) return fail(413, FILE_TOO_BIG);
  if (!hasBlobCredentials()) return fail(503, FILE_STORAGE_MISSING);

  const typeKey = sniffFileType(input.bytes);
  if (!typeKey) return fail(415, WRONG_TYPE);
  const type = FILE_TYPES[typeKey];
  const sizeBytes = input.bytes.byteLength;

  const preCheck = await checkUpload(prisma, actor, dealId, sizeBytes, now);
  if (!preCheck.ok) return preCheck;

  const pathname = `${FILE_PATH_PREFIX}${randomUUID()}.${type.ext}`;
  try {
    await put(pathname, Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: type.contentType,
    });
  } catch {
    console.error(LOG_PUT_FAILED);
    return fail(503, STORE_FAILED);
  }

  const name = cleanFileName(input.name, type.ext);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");

  let result: UploadResult;
  try {
    result = await prisma.$transaction(async (tx): Promise<UploadResult> => {
      const checked = await checkUpload(tx, actor, dealId, sizeBytes, now);
      if (!checked.ok) return checked;

      const row = await tx.salesFile.create({
        data: {
          name,
          blobPathname: pathname,
          contentType: type.contentType,
          sizeBytes,
          sha256,
          uploadedById: actor.userId,
          dealId,
          finalConfirmedAt: now,
          stageName: checked.stageName,
        },
        select: PANEL_FILE_SELECT,
      });
      await recordDealAudit(
        tx,
        actor,
        dealId,
        { action: "file_added", after: { fileId: row.id, name, sizeBytes, stageName: checked.stageName } },
        meta,
      );
      // The check above passed, so this person is the deal owner or an admin.
      return { ok: true, file: toPanelFile(row, true) };
    });
  } catch {
    console.error(LOG_SAVE_FAILED);
    await removeStoredCopy(pathname);
    return fail(503, STORE_FAILED);
  }

  if (!result.ok) await removeStoredCopy(pathname);
  return result;
}

/** `where` for a file on a live deal this person may see (a lead's file is never one). */
function visibleFileWhere(actor: SalesActor, fileId: string): Prisma.SalesFileWhereInput {
  return { id: fileId, dealId: { not: null }, deal: { archivedAt: null, ...dealOwnerWhere(actor, "everyone") } };
}

/**
 * A live file on a deal this person may see, as the download needs it, or null.
 * A stored pathname outside `sales-files/` (a row pointing at a backup, say) is
 * null too, so the store is never asked for it.
 */
export async function findFileForDownload(
  actor: SalesActor,
  fileId: string,
  db: Pick<typeof prisma, "salesFile"> = prisma,
): Promise<{ blobPathname: string; name: string; contentType: string; sizeBytes: number } | null> {
  const file = await db.salesFile.findFirst({
    where: { ...visibleFileWhere(actor, fileId), archivedAt: null },
    select: { blobPathname: true, name: true, contentType: true, sizeBytes: true },
  });
  if (!file || !isSalesFilePathname(file.blobPathname)) return null;
  return { blobPathname: file.blobPathname, name: file.name, contentType: file.contentType, sizeBytes: file.sizeBytes };
}

type RemoveResult = { ok: true; changed: boolean } | SalesFail;

/**
 * Removes a file from its deal's Files list: the deal owner or an admin. Soft:
 * the row gets `archivedAt` and the stored bytes stay. A file already removed
 * (or removed a moment earlier by someone else) changes nothing and writes no
 * history row.
 */
export async function removeDealFile(actor: SalesActor, fileId: string, meta: Meta, now: Date): Promise<RemoveResult> {
  return prisma.$transaction(async (tx): Promise<RemoveResult> => {
    const file = await tx.salesFile.findFirst({
      where: visibleFileWhere(actor, fileId),
      select: { id: true, name: true, dealId: true, deal: { select: { ownerId: true } } },
    });
    if (!file || !file.dealId || !file.deal) return fail(404, FILE_NOT_FOUND);
    if (!canEditDeal(actor, file.deal)) return fail(403, NOT_YOUR_DEAL);

    // Guarded: a file already removed, or removed a moment ago, matches nothing and writes no row.
    const removed = await tx.salesFile.updateMany({ where: { id: fileId, archivedAt: null }, data: { archivedAt: now } });
    if (removed.count === 0) return { ok: true, changed: false };

    await recordDealAudit(tx, actor, file.dealId, { action: "file_removed", before: { fileId, name: file.name } }, meta);
    return { ok: true, changed: true };
  });
}

/** Whether downloads can reach the store at all. */
export function fileStorageReady(): boolean {
  return hasBlobCredentials();
}
