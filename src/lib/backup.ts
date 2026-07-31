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
 *
 * IMPORTANT: this list must cover every model in prisma/schema.prisma. When a
 * migration adds a new model, add it here in the SAME session — this snapshot
 * silently going stale (as it did once already, covering only 11 of 45 models
 * for weeks) is exactly the kind of gap a backup exists to prevent.
 */

export const BACKUP_VERSION = 2;
export const BACKUP_PREFIX = "backups/";

type SnapshotTables = {
  teamMembers: unknown[];
  clientAccess: unknown[];
  accounts: unknown[];
  sessions: unknown[];
  verificationTokens: unknown[];
  clients: unknown[];
  clientIntakes: unknown[];
  clientUsers: unknown[];
  clientLinks: unknown[];
  clientCredentials: unknown[];
  clientHighLevelConnections: unknown[];
  conversationMessages: unknown[];
  clientNotes: unknown[];
  planningFolders: unknown[];
  planningItems: unknown[];
  planningItemLinks: unknown[];
  orderTemplates: unknown[];
  clientOrders: unknown[];
  meetingNotes: unknown[];
  landingPages: unknown[];
  assetFolders: unknown[];
  assets: unknown[];
  assetVersions: unknown[];
  assetReviewers: unknown[];
  assetDecisions: unknown[];
  assetComments: unknown[];
  assetShareLinks: unknown[];
  programTemplates: unknown[];
  stageTemplates: unknown[];
  taskTemplates: unknown[];
  campaigns: unknown[];
  workflowTemplates: unknown[];
  workflowStageTemplates: unknown[];
  workflowTaskTemplates: unknown[];
  workflowTaskTemplateLinks: unknown[];
  workflowTaskTemplateAssignees: unknown[];
  workflowFolders: unknown[];
  workflowInstances: unknown[];
  tasks: unknown[];
  taskAssignees: unknown[];
  comments: unknown[];
  taskLinks: unknown[];
  activityLogs: unknown[];
  notifications: unknown[];
  archivedTasks: unknown[];
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
    clientAccess,
    accounts,
    sessions,
    verificationTokens,
    clients,
    clientIntakes,
    clientUsers,
    clientLinks,
    clientCredentials,
    clientHighLevelConnections,
    conversationMessages,
    clientNotes,
    planningFolders,
    planningItems,
    planningItemLinks,
    orderTemplates,
    clientOrders,
    meetingNotes,
    landingPages,
    assetFolders,
    assets,
    assetVersions,
    assetReviewers,
    assetDecisions,
    assetComments,
    assetShareLinks,
    programTemplates,
    stageTemplates,
    taskTemplates,
    campaigns,
    workflowTemplates,
    workflowStageTemplates,
    workflowTaskTemplates,
    workflowTaskTemplateLinks,
    workflowTaskTemplateAssignees,
    workflowFolders,
    workflowInstances,
    tasks,
    taskAssignees,
    comments,
    taskLinks,
    activityLogs,
    notifications,
    archivedTasks,
  ] = await Promise.all([
    prisma.teamMember.findMany(),
    prisma.clientAccess.findMany(),
    prisma.account.findMany(),
    prisma.session.findMany(),
    prisma.verificationToken.findMany(),
    prisma.client.findMany(),
    prisma.clientIntake.findMany(),
    prisma.clientUser.findMany(),
    prisma.clientLink.findMany(),
    prisma.clientCredential.findMany(),
    prisma.clientHighLevelConnection.findMany(),
    prisma.conversationMessage.findMany(),
    prisma.clientNote.findMany(),
    prisma.planningFolder.findMany(),
    prisma.planningItem.findMany(),
    prisma.planningItemLink.findMany(),
    prisma.orderTemplate.findMany(),
    prisma.clientOrder.findMany(),
    prisma.meetingNote.findMany(),
    prisma.landingPage.findMany(),
    prisma.assetFolder.findMany(),
    prisma.asset.findMany(),
    prisma.assetVersion.findMany(),
    prisma.assetReviewer.findMany(),
    prisma.assetDecision.findMany(),
    prisma.assetComment.findMany(),
    prisma.assetShareLink.findMany(),
    prisma.programTemplate.findMany(),
    prisma.stageTemplate.findMany(),
    prisma.taskTemplate.findMany(),
    prisma.campaign.findMany(),
    prisma.workflowTemplate.findMany(),
    prisma.workflowStageTemplate.findMany(),
    prisma.workflowTaskTemplate.findMany(),
    prisma.workflowTaskTemplateLink.findMany(),
    prisma.workflowTaskTemplateAssignee.findMany(),
    prisma.workflowFolder.findMany(),
    prisma.workflowInstance.findMany(),
    prisma.task.findMany(),
    prisma.taskAssignee.findMany(),
    prisma.comment.findMany(),
    prisma.taskLink.findMany(),
    prisma.activityLog.findMany(),
    prisma.notification.findMany(),
    prisma.archivedTask.findMany(),
  ]);

  const tables: SnapshotTables = {
    teamMembers,
    clientAccess,
    accounts,
    sessions,
    verificationTokens,
    clients,
    clientIntakes,
    clientUsers,
    clientLinks,
    clientCredentials,
    clientHighLevelConnections,
    conversationMessages,
    clientNotes,
    planningFolders,
    planningItems,
    planningItemLinks,
    orderTemplates,
    clientOrders,
    meetingNotes,
    landingPages,
    assetFolders,
    assets,
    assetVersions,
    assetReviewers,
    assetDecisions,
    assetComments,
    assetShareLinks,
    programTemplates,
    stageTemplates,
    taskTemplates,
    campaigns,
    workflowTemplates,
    workflowStageTemplates,
    workflowTaskTemplates,
    workflowTaskTemplateLinks,
    workflowTaskTemplateAssignees,
    workflowFolders,
    workflowInstances,
    tasks,
    taskAssignees,
    comments,
    taskLinks,
    activityLogs,
    notifications,
    archivedTasks,
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
