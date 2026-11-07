import { describe, expect, it } from "vitest";

import { archivedTaskAssigneeList, canSeeArchivedTask, readArchivedTaskPeople } from "@/lib/archived-task-snapshot";
import { archivedAssigneeNames } from "@/types/task";

// An archived task's `assignees` column holds, from this change on, the
// assignee list together with the task's privacy and creator (old audit #11),
// because ArchivedTask has no columns for them. Older snapshots hold a plain
// assignee array (or null), and have no record of whether the task was private.

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

// Private tasks were added in commit e12aa82 (2026-07-30 20:35:19 UTC). Until
// 2026-08-01 local development ran on the live database, so the new columns
// could have existed there for some hours before that commit. Nothing about
// them could exist before the previous commit, 2d1ed86 (2026-07-30 05:25:33
// UTC): that is the latest moment a deleted task is known to be public.
const RECENT = new Date("2026-11-01T10:00:00.000Z");
const BEFORE_PRIVATE_TASKS = new Date("2026-07-20T09:00:00.000Z");
const LAST_MOMENT_BEFORE = new Date("2026-07-30T05:25:32.999Z");
const FIRST_UNSURE_MOMENT = new Date("2026-07-30T05:25:33.000Z");
// Between the previous commit and the privacy commit, while the columns were
// being built against the live database.
const DURING_PRIVACY_WORK = new Date("2026-07-30T12:00:00.000Z");

describe("canSeeArchivedTask", () => {
  it("shows a public task to anyone", () => {
    expect(canSeeArchivedTask({ assignees: NEW_PUBLIC, deletedById: "someone", deletedAt: RECENT }, "viewer-1")).toBe(true);
  });

  it("shows a private task only to its creator, whoever deleted it", () => {
    expect(canSeeArchivedTask({ assignees: NEW_PRIVATE, deletedById: "owner-1", deletedAt: RECENT }, "owner-1")).toBe(true);
    expect(canSeeArchivedTask({ assignees: NEW_PRIVATE, deletedById: "owner-1", deletedAt: RECENT }, "viewer-1")).toBe(false);
    expect(canSeeArchivedTask({ assignees: NEW_PRIVATE, deletedById: "viewer-1", deletedAt: RECENT }, "viewer-1")).toBe(false);
  });

  it("treats an old snapshot as possibly private, owned by the person who deleted it", () => {
    const old = [{ id: "m-1", name: "Ann" }];
    expect(canSeeArchivedTask({ assignees: old, deletedById: "viewer-1", deletedAt: RECENT }, "viewer-1")).toBe(true);
    expect(canSeeArchivedTask({ assignees: old, deletedById: "someone", deletedAt: RECENT }, "viewer-1")).toBe(false);
    expect(canSeeArchivedTask({ assignees: null, deletedById: "someone", deletedAt: RECENT }, "viewer-1")).toBe(false);
  });

  it("shows an old snapshot whose deleter is unknown to nobody", () => {
    expect(canSeeArchivedTask({ assignees: [], deletedById: null, deletedAt: RECENT }, "viewer-1")).toBe(false);
  });

  it("shows an old snapshot deleted before private tasks existed to everyone, as it could not have been private", () => {
    const old = [{ id: "m-1", name: "Ann" }];
    expect(canSeeArchivedTask({ assignees: old, deletedById: "someone", deletedAt: BEFORE_PRIVATE_TASKS }, "viewer-1")).toBe(true);
    expect(canSeeArchivedTask({ assignees: null, deletedById: "someone", deletedAt: BEFORE_PRIVATE_TASKS }, "viewer-1")).toBe(true);
    expect(canSeeArchivedTask({ assignees: [], deletedById: null, deletedAt: BEFORE_PRIVATE_TASKS }, "viewer-1")).toBe(true);
    expect(canSeeArchivedTask({ assignees: old, deletedById: "someone", deletedAt: LAST_MOMENT_BEFORE }, "viewer-1")).toBe(true);
  });

  it("keeps an old snapshot deleted from the moment private tasks may have existed private to its deleter", () => {
    const old = [{ id: "m-1", name: "Ann" }];
    expect(canSeeArchivedTask({ assignees: old, deletedById: "someone", deletedAt: FIRST_UNSURE_MOMENT }, "viewer-1")).toBe(false);
    expect(canSeeArchivedTask({ assignees: old, deletedById: "someone", deletedAt: DURING_PRIVACY_WORK }, "viewer-1")).toBe(false);
    expect(canSeeArchivedTask({ assignees: old, deletedById: "viewer-1", deletedAt: DURING_PRIVACY_WORK }, "viewer-1")).toBe(true);
  });

  it("follows a stored privacy record whenever it was taken", () => {
    expect(canSeeArchivedTask({ assignees: NEW_PRIVATE, deletedById: "owner-1", deletedAt: BEFORE_PRIVATE_TASKS }, "viewer-1")).toBe(false);
  });
});
