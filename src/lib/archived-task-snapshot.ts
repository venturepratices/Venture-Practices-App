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
 * snapshot taken before they were stored (a plain array, or null) and for
 * anything malformed: there is no privacy record to read.
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
 * Whether the archived task was private, and who created it. A snapshot with
 * no saved privacy record (one taken before the archive stored privacy) is
 * public with no recorded creator, as it was before: the owner's decision
 * (DJ, 2026-11-07). Snapshots taken since then keep their private flag and
 * creator.
 */
export function archivedTaskPrivacy(row: { assignees: unknown }): { isPrivate: boolean; createdById: string | null } {
  const people = readArchivedTaskPeople(row.assignees);
  if (people) return { isPrivate: people.isPrivate, createdById: people.createdById };
  return { isPrivate: false, createdById: null };
}

/**
 * The live-task privacy rule applied to the archive: a private task is seen
 * only by its creator, whatever else the viewer may see (admins included).
 * Everything else, old snapshots with no privacy record included, is seen by
 * anyone with archive rights and access to its client (checked by callers).
 */
export function canSeeArchivedTask(row: { assignees: unknown }, viewerId: string): boolean {
  const privacy = archivedTaskPrivacy(row);
  return !privacy.isPrivate || privacy.createdById === viewerId;
}
