import { del, list, put } from "@vercel/blob";

import { prisma } from "@/lib/prisma";

/**
 * Whole-database backup, complementary to the per-delete archive mirror in
 * src/lib/archive.ts. A scheduled job (src/app/api/cron/backup/route.ts) calls
 * createDatabaseSnapshot() + writeBackupToBlob() once a day, dumping every table
 * to a single private JSON object in Vercel Blob — a different failure domain
 * from the Neon Postgres DB, downloadable from the Vercel dashboard with no CLI.
 * If a bad migration/bug/manual tampering corrupts Neon, the latest snapshot is
 * untouched and restorable via scripts/restore-from-backup.ts.
 */

export const BACKUP_VERSION = 1;
export const BACKUP_PREFIX = "backups/";

type SnapshotTables = {
  teamMembers: unknown[];
  clients: unknown[];
  clientNotes: unknown[];
  tasks: unknown[];
  comments: unknown[];
  taskLinks: unknown[];
  activityLogs: unknown[];
  archivedTasks: unknown[];
  // Auth.js adapter tables — empty under the JWT strategy, included for completeness.
  accounts: unknown[];
  sessions: unknown[];
  verificationTokens: unknown[];
};

export type DatabaseSnapshot = {
  version: number;
  createdAt: string;
  counts: Record<keyof SnapshotTables, number>;
  tables: SnapshotTables;
};

/** Reads every table into one plain object. Dates serialize to ISO via JSON.stringify. */
export async function createDatabaseSnapshot(now: Date = new Date()): Promise<DatabaseSnapshot> {
  const [
    teamMembers,
    clients,
    clientNotes,
    tasks,
    comments,
    taskLinks,
    activityLogs,
    archivedTasks,
    accounts,
    sessions,
    verificationTokens,
  ] = await Promise.all([
    prisma.teamMember.findMany(),
    prisma.client.findMany(),
    prisma.clientNote.findMany(),
    prisma.task.findMany(),
    prisma.comment.findMany(),
    prisma.taskLink.findMany(),
    prisma.activityLog.findMany(),
    prisma.archivedTask.findMany(),
    prisma.account.findMany(),
    prisma.session.findMany(),
    prisma.verificationToken.findMany(),
  ]);

  const tables: SnapshotTables = {
    teamMembers,
    clients,
    clientNotes,
    tasks,
    comments,
    taskLinks,
    activityLogs,
    archivedTasks,
    accounts,
    sessions,
    verificationTokens,
  };

  const counts = Object.fromEntries(
    Object.entries(tables).map(([key, rows]) => [key, rows.length]),
  ) as Record<keyof SnapshotTables, number>;

  return {
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    counts,
    tables,
  };
}

/** File-safe key for the daily snapshot, e.g. "2026-07-14". */
export function backupDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Writes the snapshot to Vercel Blob as a private object. Guarded by
 * BLOB_READ_WRITE_TOKEN exactly like archive.ts — if the token is absent
 * (e.g. local dev without Blob configured) it warns and skips rather than
 * throwing, so a missing backup destination never breaks anything.
 */
export async function writeBackupToBlob(
  snapshot: DatabaseSnapshot,
  dateKey: string,
): Promise<{ written: boolean; pathname: string }> {
  const pathname = `${BACKUP_PREFIX}${dateKey}.json`;

  // Blob credentials are either a classic BLOB_READ_WRITE_TOKEN or, for stores
  // connected via Vercel's OIDC integration, a BLOB_STORE_ID (the SDK resolves
  // the short-lived OIDC token itself from the Vercel runtime at call time).
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    console.warn("No Blob credentials configured — database backup skipped for", pathname);
    return { written: false, pathname };
  }

  await put(pathname, JSON.stringify(snapshot, null, 2), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    allowOverwrite: true,
  });

  return { written: true, pathname };
}

/**
 * Deletes backup blobs older than retentionDays so storage doesn't grow
 * forever. No-op (returns 0) when the Blob token is absent.
 */
export async function pruneOldBackups(
  retentionDays = 30,
  now: Date = new Date(),
): Promise<number> {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    return 0;
  }

  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const { blobs } = await list({ prefix: BACKUP_PREFIX });
  const stale = blobs.filter((blob) => new Date(blob.uploadedAt).getTime() < cutoff);

  if (stale.length > 0) {
    await del(stale.map((blob) => blob.url));
  }

  return stale.length;
}
