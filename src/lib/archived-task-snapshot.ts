import type { ArchivedAssigneeSnapshot } from "@/types/task";

/**
 * Who an archived task belongs to. ArchivedTask has no isPrivate or
 * createdById columns, so archiveTask stores this object in the snapshot's
 * `assignees` JSON column instead of the plain assignee array it used to hold
 * (no schema change needed). `list` is that same assignee array.
 *
 * Kept free of server imports: the archive's client components read
 * assignee names through it.
 */
export type ArchivedTaskPeople = { list: ArchivedAssigneeSnapshot[]; isPrivate: boolean; createdById: string | null };

/**
 * Reads the privacy and creator stored with a snapshot. Returns null for a
 * snapshot taken before they were stored (a plain array, or null), and for
 * anything malformed, so callers treat it as "privacy unknown" rather than
 * as public.
 */
export function readArchivedTaskPeople(value: unknown): ArchivedTaskPeople | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  if (!Array.isArray(stored.list) || typeof stored.isPrivate !== "boolean") return null;
  return {
    list: stored.list as ArchivedAssigneeSnapshot[],
    isPrivate: stored.isPrivate,
    createdById: typeof stored.createdById === "string" ? stored.createdById : null,
  };
}

/**
 * The snapshot's assignees, whichever shape it was stored in: the current
 * object, the older plain array, or (oldest, before multiple assignees) the
 * single assigneeId/assigneeName columns.
 */
export function archivedTaskAssigneeList(row: {
  assignees: unknown;
  assigneeId: string | null;
  assigneeName: string | null;
}): ArchivedAssigneeSnapshot[] {
  const people = readArchivedTaskPeople(row.assignees);
  if (people) return people.list;
  if (Array.isArray(row.assignees)) return row.assignees as ArchivedAssigneeSnapshot[];
  return row.assigneeId ? [{ id: row.assigneeId, name: row.assigneeName ?? "" }] : [];
}

/**
 * No task deleted before this moment can have been private. Private tasks
 * (Task.isPrivate and Task.createdById) arrived in commit e12aa82 at
 * 2026-07-30 20:35:19 UTC, but until 2026-08-01 local development ran on the
 * live database, so those columns may have existed there a few hours before
 * that commit. This is the time of the commit before it (2d1ed86), when that
 * work had not started.
 */
const PRIVATE_TASKS_POSSIBLE_FROM = new Date("2026-07-30T05:25:33.000Z");

/**
 * Whether the archived task was private, and who created it. Null when that
 * is unknown: a snapshot taken before privacy was stored, of a task deleted
 * after private tasks could exist. Older snapshots than that were public and
 * had no recorded creator.
 */
export function archivedTaskPrivacy(row: {
  assignees: unknown;
  deletedAt: Date;
}): { isPrivate: boolean; createdById: string | null } | null {
  const people = readArchivedTaskPeople(row.assignees);
  if (people) return { isPrivate: people.isPrivate, createdById: people.createdById };
  if (row.deletedAt.getTime() < PRIVATE_TASKS_POSSIBLE_FROM.getTime()) return { isPrivate: false, createdById: null };
  return null;
}

/**
 * The live-task privacy rule applied to the archive: a private task is seen
 * only by its creator, whatever else the viewer may see (admins included).
 *
 * When it is unknown whether the task was private (see archivedTaskPrivacy),
 * it is treated as private to the person who deleted it: a private task can
 * only be deleted on its own by its creator, which makes the deleter the one
 * person who could already see it. With no deleter on record (their account
 * was removed), nobody sees it in the app.
 */
export function canSeeArchivedTask(
  row: { assignees: unknown; deletedById: string | null; deletedAt: Date },
  viewerId: string
): boolean {
  const privacy = archivedTaskPrivacy(row);
  if (privacy) return !privacy.isPrivate || privacy.createdById === viewerId;
  return row.deletedById !== null && row.deletedById === viewerId;
}
