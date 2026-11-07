import { describe, expect, it, vi } from "vitest";

// The deal panel's History list: how each locked history row reads, and how the
// list pages. The default `prisma` import is mocked only so loading the modules
// stays inert; loadDealTimeline gets a fake database that records every call.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { describeAuditRow, loadDealTimeline, loadLeadTimeline } = await import("@/lib/sales/timeline");
const { endOfDay } = await import("@/lib/utils");

type SalesActor = import("@/lib/sales/access").SalesActor;
type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };

const names = new Map([["b", "Ben Example"]]);
const describe_ = (action: string, after?: unknown, before?: unknown, actorType = "USER") =>
  describeAuditRow({ action, actorType, before: before ?? null, after: after ?? null }, names);
const describeFor = (entityType: string | undefined, action: string, after?: unknown, before?: unknown) =>
  describeAuditRow({ entityType, action, actorType: "USER", before: before ?? null, after: after ?? null }, names);
const EM_DASH = String.fromCharCode(0x2014);

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
    ["stage put back by an undo (M8)", describe_("stage_changed", { stageId: "s1", stageName: "Lead In", stageEnteredAt: "2026-10-30T14:00:00.000Z", undo: true }, { stageId: "s2", stageName: "Proposal Sent", stageEnteredAt: "2026-11-05T14:58:00.000Z" }), "stage", "Moved back to Lead In (undo)"],
    ["won", describe_("status_changed", { status: "WON" }, { status: "OPEN" }), "won", "Marked as won"],
    ["lost", describe_("status_changed", { status: "LOST", lostReason: "Price" }, { status: "OPEN" }), "lost", "Marked as lost: Price"],
    ["lost with a comment", describe_("status_changed", { status: "LOST", lostReason: "Price", lostComment: "Went with a cheaper printer" }, { status: "OPEN" }), "lost", "Marked as lost: Price. Went with a cheaper printer"],
    ["reopened", describe_("status_changed", { status: "OPEN" }, { status: "LOST" }), "reopened", "Reopened"],
    ["value with monthly", describe_("value_changed", { valueCents: 1_440_000, mrrCents: 120_000 }, { valueCents: 0, mrrCents: 0 }), "value", "Value set to $14,400 ($1,200/mo)"],
    ["value without monthly", describe_("value_changed", { valueCents: 1_440_000, mrrCents: 0 }, { valueCents: 0, mrrCents: 0 }), "value", "Value set to $14,400"],
    ["owner", describe_("owner_changed", { ownerId: "b" }, { ownerId: "r" }), "owner", "Owner changed to Ben E."],
    ["owner with moved activities", describe_("owner_changed", { ownerId: "b", movedActivityIds: ["a1"] }, { ownerId: "r" }), "owner", "Owner changed to Ben E."],
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
    // Only a real `true` reads as an undo.
    expect(describe_("stage_changed", { stageId: "s1", stageName: "Lead In", undo: "yes" }).text).toBe("Moved to Lead In");
    expect(describe_("stage_changed", { undo: true }).text).toBe("Moved back to another stage (undo)");
    // A contact change with no readable payload names nothing in particular.
    expect(describe_("contact_changed", "junk")).toEqual({ icon: "contact", text: "Contacts changed" });
  });

  it.each([
    ["created", describeFor("SalesLead", "created", { title: "Oak Creek Dental" }), "created", "Lead created"],
    ["archived", describeFor("SalesLead", "archived", { archivedAt: "2026-11-05T15:00:00.000Z" }, { archivedAt: null }), "deleted", "Lead deleted"],
    ["delete refused", describeFor("SalesLead", "delete_refused"), "deleted", "Tried to delete this lead (refused)"],
    ["archived by status", describeFor("SalesLead", "status_changed", { status: "ARCHIVED" }, { status: "OPEN" }), "deleted", "Archived"],
    ["restored", describeFor("SalesLead", "status_changed", { status: "OPEN" }, { status: "ARCHIVED" }), "reopened", "Restored to the Inbox"],
    ["converted", describeFor("SalesLead", "converted", { dealId: "d7" }), "converted", "Converted to a deal"],
    ["owner", describeFor("SalesLead", "owner_changed", { ownerId: "b" }, { ownerId: "r" }), "owner", "Owner changed to Ben E."],
    ["renamed", describeFor("SalesLead", "updated", { title: "Oak Creek Dental" }, { title: "Oak" }), "field", "Renamed to Oak Creek Dental"],
    ["an update with nothing readable", describeFor("SalesLead", "updated", {}, {}), "field", "Lead updated"],
    ["an unknown action", describeFor("SalesLead", "something_new", { x: 1 }), "field", "Lead updated"],
    ["deal created", describeFor("SalesDeal", "created", { title: "Oak" }), "created", "Deal created"],
    ["deal unknown action", describeFor("SalesDeal", "something_new", { x: 1 }), "field", "Deal updated"],
    ["no entity, created", describeFor(undefined, "created", { title: "Oak" }), "created", "Deal created"],
    ["no entity, unknown action", describeFor(undefined, "something_new", { x: 1 }), "field", "Deal updated"],
    ["no entity, deal reopened", describeFor(undefined, "status_changed", { status: "OPEN" }, { status: "LOST" }), "reopened", "Reopened"],
    ["deal converted from a lead", describeFor("SalesDeal", "created", { title: "Crestview Dental", source: "Referral", fromLeadId: "l1" }), "converted", "Converted from lead (Referral)"],
    ["deal converted from a lead with no source", describeFor("SalesDeal", "created", { title: "Crestview Dental", source: null, fromLeadId: "l1" }), "converted", "Converted from a lead"],
    ["no entity, converted from a lead", describeFor(undefined, "created", { source: "Outbound", fromLeadId: "l1" }), "converted", "Converted from lead (Outbound)"],
    ["lead created, a stray lead id ignored", describeFor("SalesLead", "created", { title: "Oak", fromLeadId: "l1" }), "created", "Lead created"],
  ])("words lead history: %s", (_name, result, icon, text) => {
    expect(result).toEqual({ icon, text });
    expect(result.text).not.toContain(EM_DASH);
  });

  const oak = { organizationId: "o1", organizationName: "Oak Creek Dental" };
  const noOrg = { organizationId: null, organizationName: null };
  const sarah = { personId: "p1", personName: "Sarah K." };
  const dana = { personId: "p2", personName: "Dana Q." };
  const noPerson = { personId: null, personName: null };

  it.each([
    ["organization changed", { ...noOrg, ...sarah }, { ...oak, ...sarah }, "Organization changed to Oak Creek Dental"],
    ["organization removed", { ...oak, ...sarah }, { ...noOrg, ...sarah }, "Organization removed"],
    ["person changed", { ...oak, ...dana }, { ...oak, ...sarah }, "Person changed to Sarah K."],
    ["person removed", { ...oak, ...sarah }, { ...oak, ...noPerson }, "Person removed"],
    ["both changed", { ...noOrg, ...dana }, { ...oak, ...sarah }, "Organization and person changed"],
    ["person merged", { ...oak, ...dana }, { ...oak, ...sarah, merged: true }, "Person changed to Sarah K. (merged duplicates)"],
    ["organization merged", { ...noOrg, ...sarah }, { ...oak, ...sarah, merged: true }, "Organization changed to Oak Creek Dental (merged duplicates)"],
    ["a name that is gone", { ...noOrg, ...sarah }, { organizationId: "o1", organizationName: null, ...sarah }, "Organization changed"],
  ])("words contact changes: %s", (_name, before, after, text) => {
    for (const entityType of ["SalesDeal", "SalesLead", undefined]) {
      const result = describeFor(entityType, "contact_changed", after, before);
      expect(result, String(entityType)).toEqual({ icon: "contact", text });
      expect(result.text).not.toContain(EM_DASH);
    }
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

function fakeDb(opts: { visible?: boolean; rows?: Row[]; notes?: Row[]; fromLead?: string } = {}) {
  return {
    salesDeal: {
      // The lead a deal was converted from comes back only when the query asks for it.
      findFirst: vi.fn<(args: Args) => Promise<unknown>>(async (args) => {
        if (opts.visible === false) return null;
        const deal: Row = { id: "d1", ownerId: "r" };
        if ((args.select as Row | undefined)?.convertedFromLead) deal.convertedFromLead = opts.fromLead ? { id: opts.fromLead } : null;
        return deal;
      }),
    },
    salesLead: {
      findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => (opts.visible === false ? null : { id: "l1" })),
    },
    salesAuditLog: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.rows ?? [log(1)]) },
    teamMember: {
      findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => [
        { id: "r", name: "Rachel P." },
        // A stored full name, to show History shortens it.
        { id: "b", name: "Ben Example" },
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
        actorName: "Ben E.",
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

  it("reads each row's entity, so a row is worded for what it belongs to", async () => {
    const db = fakeDb({ rows: [log(1, { entityType: "SalesDeal" })] });
    const page = await loadDealTimeline(rep, "d1", null, db as never);

    expect(db.salesAuditLog.findMany.mock.calls[0][0].select).toMatchObject({ entityType: true, action: true });
    expect(page?.entries[0].text).toBe("Deal created");
  });

  it("a converted deal's History includes its lead's", async () => {
    const sources = [
      { entityType: "SalesDeal", entityId: "d1" },
      { entityType: "SalesLead", entityId: "l1" },
    ];
    const rows = [
      log(1, { entityType: "SalesDeal", action: "created", after: { title: "Crestview Dental", source: "Referral", fromLeadId: "l1" } }),
      log(2, { entityType: "SalesLead", action: "created", after: { title: "Crestview Dental" } }),
    ];
    const db = fakeDb({ fromLead: "l1", rows });
    const page = await loadDealTimeline(rep, "d1", null, db as never);

    expect(db.salesAuditLog.findMany.mock.calls[0][0].where).toEqual({ AND: [{ OR: sources }] });
    expect(page?.entries.map((entry) => [entry.icon, entry.text])).toEqual([
      ["converted", "Converted from lead (Referral)"],
      ["created", "Lead created"],
    ]);

    // "Show older" keeps both sources.
    await loadDealTimeline(rep, "d1", { at: "2026-11-04T12:00:00.000Z", id: "log9" }, db as never);
    const cursorAt = new Date("2026-11-04T12:00:00.000Z");
    expect(db.salesAuditLog.findMany.mock.calls[1][0].where).toEqual({
      AND: [{ OR: sources }, { OR: [{ at: { lt: cursorAt } }, { at: cursorAt, id: { lt: "log9" } }] }],
    });

    // A deal that did not come from a lead reads only its own rows.
    const plain = fakeDb();
    await loadDealTimeline(rep, "d1", null, plain as never);
    expect(plain.salesAuditLog.findMany.mock.calls[0][0].where).toEqual({ entityType: "SalesDeal", entityId: "d1" });
  });
});

// --- loadLeadTimeline ---

describe("loadLeadTimeline", () => {
  it("returns null, and reads no history, when the lead is not visible", async () => {
    const db = fakeDb({ visible: false });

    expect(await loadLeadTimeline(rep, "l1", null, db as never)).toBeNull();
    expect(db.salesLead.findFirst.mock.calls[0][0].where).toEqual({ id: "l1", archivedAt: null, ownerId: "r" });
    expect(db.salesAuditLog.findMany).not.toHaveBeenCalled();
  });

  it("an admin sees any rep's lead history", async () => {
    const db = fakeDb();
    await loadLeadTimeline(admin, "l1", null, db as never);

    expect(db.salesLead.findFirst.mock.calls[0][0].where).toEqual({ id: "l1", archivedAt: null });
  });

  it("loads a lead's history, newest first, worded as a lead's", async () => {
    const rows = [
      log(1, { entityType: "SalesLead", action: "converted", after: { dealId: "d7" } }),
      log(2, { entityType: "SalesLead", action: "created", after: { title: "Oak Creek Dental" } }),
    ];
    const db = fakeDb({ rows });
    const page = await loadLeadTimeline(rep, "l1", null, db as never);

    expect(db.salesAuditLog.findMany.mock.calls[0][0]).toMatchObject({
      where: { entityType: "SalesLead", entityId: "l1" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: 31,
    });
    expect(db.salesAuditLog.findMany.mock.calls[0][0].where).toEqual({ entityType: "SalesLead", entityId: "l1" });
    expect(page).toEqual({
      entries: [
        { id: "log1", at: rows[0].at.toISOString(), actorType: "USER", actorName: "Rachel P.", icon: "converted", text: "Converted to a deal" },
        { id: "log2", at: rows[1].at.toISOString(), actorType: "USER", actorName: "Rachel P.", icon: "created", text: "Lead created" },
      ],
      nextCursor: null,
    });
  });

  it("continues after the cursor and pages at 30", async () => {
    const rows = Array.from({ length: 31 }, (_, i) => log(i + 1, { entityType: "SalesLead" }));
    const db = fakeDb({ rows });
    const page = await loadLeadTimeline(rep, "l1", { at: "2026-11-04T12:00:00.000Z", id: "log9" }, db as never);

    const cursorAt = new Date("2026-11-04T12:00:00.000Z");
    expect(db.salesAuditLog.findMany.mock.calls[0][0].where).toEqual({
      entityType: "SalesLead",
      entityId: "l1",
      OR: [{ at: { lt: cursorAt } }, { at: cursorAt, id: { lt: "log9" } }],
    });
    expect(page?.entries).toHaveLength(30);
    expect(page?.nextCursor).toEqual({ at: rows[29].at.toISOString(), id: "log30" });
  });

  it("attaches a lead note's current text, editable by its author", async () => {
    const rows = [log(1, { entityType: "SalesLead", action: "note_added", after: { noteId: "n1" } })];
    const db = fakeDb({ rows, notes: [{ id: "n1", body: "Asked for a call after 3 PM.", authorId: "r" }] });
    const page = await loadLeadTimeline(rep, "l1", null, db as never);

    expect(page?.entries[0].note).toEqual({ id: "n1", body: "Asked for a call after 3 PM.", canEdit: true });
  });
});
