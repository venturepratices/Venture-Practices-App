import { describe, expect, it, vi } from "vitest";

// The deal panel's History list: how each locked history row reads, and how the
// list pages. The default `prisma` import is mocked only so loading the modules
// stays inert; loadDealTimeline gets a fake database that records every call.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { describeAuditRow, loadDealTimeline } = await import("@/lib/sales/timeline");
const { endOfDay } = await import("@/lib/utils");

type SalesActor = import("@/lib/sales/access").SalesActor;
type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };

const names = new Map([["b", "Ben Shaver"]]);
const describe_ = (action: string, after?: unknown, before?: unknown, actorType = "USER") =>
  describeAuditRow({ action, actorType, before: before ?? null, after: after ?? null }, names);

const call = (subject: string, day: string, createdBy: string, type = "CALL") => ({
  activityId: "a1",
  type,
  subject,
  dueAt: endOfDay(day).toISOString(),
  hasTime: false,
  createdBy,
});

describe("describeAuditRow", () => {
  it.each([
    ["created", describe_("created", { title: "Oak" }), "created", "Deal created"],
    ["stage by a person", describe_("stage_changed", { stageId: "s2", stageName: "Proposal Sent" }, { stageId: "s1", stageName: "Lead In" }), "stage", "Moved to Proposal Sent"],
    ["stage by the rule", describe_("stage_changed", { stageId: "s3", stageName: "No Show" }, { stageId: "s2", stageName: "Demo" }, "SYSTEM"), "stage", "Moved to No Show (No Show rule)"],
    ["won", describe_("status_changed", { status: "WON" }, { status: "OPEN" }), "won", "Marked as won"],
    ["lost", describe_("status_changed", { status: "LOST", lostReason: "Price" }, { status: "OPEN" }), "lost", "Marked as lost: Price"],
    ["lost with a comment", describe_("status_changed", { status: "LOST", lostReason: "Price", lostComment: "Went with a cheaper printer" }, { status: "OPEN" }), "lost", "Marked as lost: Price. Went with a cheaper printer"],
    ["reopened", describe_("status_changed", { status: "OPEN" }, { status: "LOST" }), "reopened", "Reopened"],
    ["value with monthly", describe_("value_changed", { valueCents: 1_440_000, mrrCents: 120_000 }, { valueCents: 0, mrrCents: 0 }), "value", "Value set to $14,400 ($1,200/mo)"],
    ["value without monthly", describe_("value_changed", { valueCents: 1_440_000, mrrCents: 0 }, { valueCents: 0, mrrCents: 0 }), "value", "Value set to $14,400"],
    ["owner", describe_("owner_changed", { ownerId: "b" }, { ownerId: "r" }), "owner", "Owner changed to Ben S."],
    ["owner with moved activities", describe_("owner_changed", { ownerId: "b", movedActivityIds: ["a1"] }, { ownerId: "r" }), "owner", "Owner changed to Ben S."],
    ["renamed", describe_("updated", { title: "Oak Creek Dental" }, { title: "Oak" }), "field", "Renamed to Oak Creek Dental"],
    ["field set", describe_("field_changed", { fieldKey: "territory-hold-expiry", label: "Territory Hold Expiry", value: "2026-11-19" }, { fieldKey: "territory-hold-expiry", label: "Territory Hold Expiry", value: null }), "field", "Territory Hold Expiry set to 2026-11-19"],
    ["field cleared", describe_("field_changed", { fieldKey: "territory-hold-expiry", label: "Territory Hold Expiry", value: null }, { fieldKey: "territory-hold-expiry", label: "Territory Hold Expiry", value: "2026-11-19" }), "field", "Territory Hold Expiry cleared"],
    ["archived", describe_("archived", { archivedAt: "2026-11-05T15:00:00.000Z" }, { archivedAt: null }), "deleted", "Deal deleted"],
    ["delete refused", describe_("delete_refused"), "deleted", "Tried to delete this deal (refused)"],
    ["activity scheduled", describe_("activity_added", call("First call", "2026-11-06", "u1")), "activity", "Call scheduled: First call (Nov 6)"],
    ["activity by the No Show rule", describe_("activity_added", call("Reschedule the missed demo", "2026-11-05", "rule:no-show"), undefined, "SYSTEM"), "activity", "Call added by the No Show rule: Reschedule the missed demo (Nov 5)"],
    ["activity by the territory hold rule", describe_("activity_added", call("Territory hold check", "2026-11-12", "rule:territory-hold", "DEADLINE")), "activity", "Deadline added by the territory hold rule: Territory hold check (Nov 12)"],
    ["activity done", describe_("activity_done", { activityId: "a1", type: "CALL", subject: "First call" }), "done", "Call done: First call"],
    ["activity reopened", describe_("activity_reopened", { activityId: "a1", type: "CALL", subject: "First call" }), "activity", "Call reopened: First call"],
    ["meeting missed", describe_("activity_missed", { activityId: "a1", type: "MEETING", subject: "Demo" }, undefined, "SYSTEM"), "missed", "Meeting missed: Demo"],
    ["activity removed", describe_("activity_removed", undefined, { activityId: "a1", type: "CALL", subject: "Reschedule the missed demo" }), "activity", "Call removed: Reschedule the missed demo"],
    ["note added", describe_("note_added", { noteId: "n1" }), "note", "Note added"],
    ["note edited", describe_("note_edited", { noteId: "n1", body: "New" }, { noteId: "n1", body: "Old" }), "note", "Note edited"],
  ])("%s", (_name, result, icon, text) => {
    expect(result).toEqual({ icon, text });
    // No em dash (U+2014) in any History line.
    expect(result.text).not.toContain(String.fromCharCode(0x2014));
  });

  it("reads source changes and combined edits", () => {
    expect(describe_("updated", { source: "Referral" }, { source: null }).text).toBe("Source set to Referral");
    expect(describe_("updated", { source: null }, { source: "Referral" }).text).toBe("Source cleared");
    expect(describe_("updated", { title: "Oak", source: "Referral" }, { title: "Old", source: null }).text).toBe(
      "Renamed to Oak. Source set to Referral",
    );
  });

  it("never crashes on a row it does not know or a payload it does not expect", () => {
    expect(describe_("something_new", { x: 1 })).toEqual({ icon: "field", text: "Deal updated" });
    expect(describe_("owner_changed", { ownerId: "gone" }).text).toBe("Owner changed");
    expect(describe_("status_changed", { status: "LOST" }).text).toBe("Marked as lost");
    expect(describe_("status_changed", { status: "LOST", lostComment: "Closed the practice" }).text).toBe(
      "Marked as lost. Closed the practice",
    );
    expect(describe_("activity_done", null).text).toBe("Activity done");
    expect(describe_("stage_changed", "junk").text).toBe("Moved to another stage");
  });
});

// --- loadDealTimeline ---

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const admin: SalesActor = { userId: "a", isAdmin: true, seesAllDeals: true, via: "user" };

const log = (i: number, extra: Row = {}) => ({
  id: `log${i}`,
  at: new Date(Date.UTC(2026, 10, 5, 12, 0, 0) - i * 60_000),
  actorType: "USER",
  actorId: "r",
  action: "created",
  before: null,
  after: { title: "Oak" },
  ...extra,
});

function fakeDb(opts: { visible?: boolean; rows?: Row[]; notes?: Row[] } = {}) {
  return {
    salesDeal: {
      findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => (opts.visible === false ? null : { id: "d1", ownerId: "r" })),
    },
    salesAuditLog: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.rows ?? [log(1)]) },
    teamMember: {
      findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => [
        { id: "r", name: "Rachel P." },
        // A stored full name, to show History shortens it.
        { id: "b", name: "Ben Shaver" },
      ]),
    },
    salesNote: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.notes ?? []) },
  };
}

describe("loadDealTimeline", () => {
  it("returns null, and reads no history, when the deal is not visible", async () => {
    const db = fakeDb({ visible: false });

    expect(await loadDealTimeline(rep, "d1", null, db as never)).toBeNull();
    expect(db.salesDeal.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", archivedAt: null, ownerId: "r" });
    expect(db.salesAuditLog.findMany).not.toHaveBeenCalled();
  });

  it("reads the newest 30 rows of this deal, plus one to know if there are more", async () => {
    const db = fakeDb();
    await loadDealTimeline(rep, "d1", null, db as never);

    expect(db.salesAuditLog.findMany.mock.calls[0][0]).toMatchObject({
      where: { entityType: "SalesDeal", entityId: "d1" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: 31,
    });
    expect(db.salesAuditLog.findMany.mock.calls[0][0].where).not.toHaveProperty("OR");
  });

  it("continues after the cursor", async () => {
    const db = fakeDb();
    await loadDealTimeline(rep, "d1", { at: "2026-11-04T12:00:00.000Z", id: "log9" }, db as never);

    const cursorAt = new Date("2026-11-04T12:00:00.000Z");
    expect(db.salesAuditLog.findMany.mock.calls[0][0].where).toEqual({
      entityType: "SalesDeal",
      entityId: "d1",
      OR: [{ at: { lt: cursorAt } }, { at: cursorAt, id: { lt: "log9" } }],
    });
  });

  it("pages at 30 entries and points at the last one shown", async () => {
    const rows = Array.from({ length: 31 }, (_, i) => log(i + 1));
    const page = await loadDealTimeline(rep, "d1", null, fakeDb({ rows }) as never);

    expect(page?.entries).toHaveLength(30);
    expect(page?.nextCursor).toEqual({ at: rows[29].at.toISOString(), id: "log30" });
  });

  it("has no next page when everything fit", async () => {
    const page = await loadDealTimeline(rep, "d1", null, fakeDb() as never);

    expect(page?.nextCursor).toBeNull();
  });

  it("names who did it from one lookup over actors and owners", async () => {
    const db = fakeDb({
      rows: [
        log(1, { actorId: "b", action: "owner_changed", before: { ownerId: "b" }, after: { ownerId: "r" } }),
        log(2, { actorType: "SYSTEM", actorId: null, action: "stage_changed", after: { stageId: "s9", stageName: "No Show" } }),
      ],
    });
    const page = await loadDealTimeline(rep, "d1", null, db as never);

    expect(db.teamMember.findMany).toHaveBeenCalledTimes(1);
    const ids = (db.teamMember.findMany.mock.calls[0][0].where as { id: { in: string[] } }).id.in;
    expect([...ids].sort()).toEqual(["b", "r"]);
    expect(page?.entries).toEqual([
      {
        id: "log1",
        at: log(1).at.toISOString(),
        actorType: "USER",
        actorName: "Ben S.",
        icon: "owner",
        text: "Owner changed to Rachel P.",
      },
      {
        id: "log2",
        at: log(2).at.toISOString(),
        actorType: "SYSTEM",
        actorName: null,
        icon: "stage",
        text: "Moved to No Show (No Show rule)",
      },
    ]);
  });

  it("attaches each added note's current text, editable by its author or an admin", async () => {
    const rows = [
      log(1, { action: "note_added", after: { noteId: "n1" } }),
      log(2, { action: "note_added", actorId: "b", after: { noteId: "n2" } }),
      log(3, { action: "note_added", after: { noteId: "n3" } }),
    ];
    const notes = [
      { id: "n1", body: "Called, left a message.", authorId: "r" },
      { id: "n2", body: "Wants pricing.", authorId: "b" },
    ];

    const db = fakeDb({ rows, notes });
    const page = await loadDealTimeline(rep, "d1", null, db as never);

    expect(db.salesNote.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["n1", "n2", "n3"] }, archivedAt: null });
    expect(page?.entries.map((entry) => entry.note)).toEqual([
      { id: "n1", body: "Called, left a message.", canEdit: true },
      { id: "n2", body: "Wants pricing.", canEdit: false },
      // n3 was archived, so it shows as a plain "Note added" line.
      undefined,
    ]);

    const asAdmin = await loadDealTimeline(admin, "d1", null, fakeDb({ rows, notes }) as never);
    expect(asAdmin?.entries.map((entry) => entry.note?.canEdit)).toEqual([true, true, undefined]);
  });

  it("skips the note lookup when the page has no notes", async () => {
    const db = fakeDb();
    await loadDealTimeline(rep, "d1", null, db as never);

    expect(db.salesNote.findMany).not.toHaveBeenCalled();
  });
});
