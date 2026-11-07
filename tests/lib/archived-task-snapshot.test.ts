import { describe, expect, it } from "vitest";

import { archivedTaskAssigneeList, archivedTaskPrivacy, canSeeArchivedTask, readArchivedTaskPeople } from "@/lib/archived-task-snapshot";
import { archivedAssigneeNames } from "@/types/task";

// An archived task's `assignees` column holds, from this change on, the
// assignee list together with the task's privacy and creator (old audit #11),
// because ArchivedTask has no columns for them. Older snapshots hold a plain
// assignee array (or null), and have no record of whether the task was private:
// they are treated as public, as they were before.

const NEW_PUBLIC = { list: [{ id: "m-1", name: "Ann" }, { id: "m-2", name: "Bo" }], isPrivate: false, createdById: "creator-1" };
const NEW_PRIVATE = { list: [], isPrivate: true, createdById: "owner-1" };

describe("readArchivedTaskPeople", () => {
  it("reads privacy and creator from a new snapshot", () => {
    expect(readArchivedTaskPeople(NEW_PRIVATE)).toEqual({ list: [], isPrivate: true, createdById: "owner-1" });
    expect(readArchivedTaskPeople(NEW_PUBLIC)).toEqual(NEW_PUBLIC);
  });

  it("keeps a missing creator as null", () => {
    expect(readArchivedTaskPeople({ list: [], isPrivate: false, createdById: null })).toEqual({
      list: [],
      isPrivate: false,
      createdById: null,
    });
  });

  it("returns null for an old snapshot (plain array or nothing), which has no privacy record", () => {
    expect(readArchivedTaskPeople([{ id: "m-1", name: "Ann" }])).toBeNull();
    expect(readArchivedTaskPeople([])).toBeNull();
    expect(readArchivedTaskPeople(null)).toBeNull();
  });

  it("returns null for a malformed value rather than guessing it is public", () => {
    expect(readArchivedTaskPeople({ list: [] })).toBeNull();
    expect(readArchivedTaskPeople({ isPrivate: false, createdById: null })).toBeNull();
    expect(readArchivedTaskPeople({ list: [], isPrivate: "no", createdById: null })).toBeNull();
  });
});

describe("archivedTaskAssigneeList", () => {
  it("reads the list from a new snapshot", () => {
    expect(archivedTaskAssigneeList({ assignees: NEW_PUBLIC, assigneeId: "m-1", assigneeName: "Ann" })).toEqual(NEW_PUBLIC.list);
  });

  it("reads an old plain-array snapshot", () => {
    expect(archivedTaskAssigneeList({ assignees: [{ id: "m-3", name: "Cy" }], assigneeId: "m-3", assigneeName: "Cy" })).toEqual([
      { id: "m-3", name: "Cy" },
    ]);
  });

  it("falls back to the single legacy assignee on the oldest snapshots", () => {
    expect(archivedTaskAssigneeList({ assignees: null, assigneeId: "m-4", assigneeName: "Di" })).toEqual([{ id: "m-4", name: "Di" }]);
    expect(archivedTaskAssigneeList({ assignees: null, assigneeId: null, assigneeName: null })).toEqual([]);
  });
});

describe("archivedAssigneeNames", () => {
  it("lists every assignee of a new snapshot, not only the first", () => {
    expect(archivedAssigneeNames({ assignees: NEW_PUBLIC, assigneeName: "Ann" })).toBe("Ann, Bo");
  });

  it("still reads old snapshots", () => {
    expect(archivedAssigneeNames({ assignees: [{ id: "m-1", name: "Ann" }], assigneeName: "Ann" })).toBe("Ann");
    expect(archivedAssigneeNames({ assignees: null, assigneeName: "Di" })).toBe("Di");
    expect(archivedAssigneeNames({ assignees: NEW_PRIVATE, assigneeName: null })).toBe("Unassigned");
  });
});

describe("archivedTaskPrivacy", () => {
  it("reads the stored privacy and creator of a new snapshot", () => {
    expect(archivedTaskPrivacy({ assignees: NEW_PRIVATE })).toEqual({ isPrivate: true, createdById: "owner-1" });
    expect(archivedTaskPrivacy({ assignees: NEW_PUBLIC })).toEqual({ isPrivate: false, createdById: "creator-1" });
  });

  // Owner decision (DJ, 2026-11-07): a snapshot with no saved privacy record
  // is public, as it was before the archive stored privacy, with no creator.
  it("treats an old snapshot (plain array or nothing) as public with no recorded creator", () => {
    expect(archivedTaskPrivacy({ assignees: [{ id: "m-1", name: "Ann" }] })).toEqual({ isPrivate: false, createdById: null });
    expect(archivedTaskPrivacy({ assignees: [] })).toEqual({ isPrivate: false, createdById: null });
    expect(archivedTaskPrivacy({ assignees: null })).toEqual({ isPrivate: false, createdById: null });
  });
});

/** An archived row as the routes load it: who deleted it and when do not change who may see it. */
function archived(assignees: unknown, deletedById: string | null, deletedAt = new Date("2026-11-01T10:00:00.000Z")) {
  return { assignees, deletedById, deletedAt };
}

describe("canSeeArchivedTask", () => {
  it("shows a public task to anyone", () => {
    expect(canSeeArchivedTask({ assignees: NEW_PUBLIC }, "viewer-1")).toBe(true);
  });

  it("shows a private task only to its creator, whoever deleted it", () => {
    expect(canSeeArchivedTask(archived(NEW_PRIVATE, "owner-1"), "owner-1")).toBe(true);
    expect(canSeeArchivedTask(archived(NEW_PRIVATE, "owner-1"), "viewer-1")).toBe(false);
    expect(canSeeArchivedTask(archived(NEW_PRIVATE, "viewer-1"), "viewer-1")).toBe(false);
  });

  it("hides a private task whose creator is unknown from everyone", () => {
    expect(canSeeArchivedTask({ assignees: { list: [], isPrivate: true, createdById: null } }, "viewer-1")).toBe(false);
  });

  it("shows an old snapshot (no privacy record) to anyone, whoever deleted it and whenever", () => {
    const old = [{ id: "m-1", name: "Ann" }];
    expect(canSeeArchivedTask(archived(old, "someone"), "viewer-1")).toBe(true);
    expect(canSeeArchivedTask(archived(old, "someone", new Date("2026-07-30T12:00:00.000Z")), "viewer-1")).toBe(true);
    expect(canSeeArchivedTask(archived(old, "someone", new Date("2026-07-20T09:00:00.000Z")), "viewer-1")).toBe(true);
    expect(canSeeArchivedTask(archived(null, "someone"), "viewer-1")).toBe(true);
    expect(canSeeArchivedTask(archived([], null), "viewer-1")).toBe(true);
  });
});
