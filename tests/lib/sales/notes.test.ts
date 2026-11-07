import { beforeEach, describe, expect, it, vi } from "vitest";

// Adding notes to a deal and editing them, through their routes and the
// service, against a small fake database and a fake Sales gate. Note bodies are
// plain text, stored exactly as typed (never parsed as HTML), and an edit keeps
// the old text in its history row (Decision 16). Nothing here reaches a real
// database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; data: Row; select?: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "s", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };

const createdAt = new Date("2026-11-05T15:00:00Z");
const editedAt = new Date("2026-11-05T16:00:00Z");

const deal = (id: string, extra: Row = {}): Row => ({ id, ownerId: "r", status: "OPEN", archivedAt: null, ...extra });
const lead = (id: string, extra: Row = {}): Row => ({ id, ownerId: "r", status: "OPEN", archivedAt: null, ...extra });
const note = (id: string, extra: Row = {}): Row => ({
  id,
  body: "old",
  authorId: "r",
  dealId: "d1",
  leadId: null,
  archivedAt: null,
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

const state = { deals: [] as Row[], leads: [] as Row[], notes: [] as Row[], audits: [] as Row[] };

/** A small `where` matcher: plain equality (dates by time) or `{ not: value }`. */
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, condition]) => {
    if (condition instanceof Date) return row[key] instanceof Date && (row[key] as Date).getTime() === condition.getTime();
    if (condition !== null && typeof condition === "object" && "not" in (condition as Row)) {
      return row[key] !== (condition as Row).not;
    }
    return row[key] === condition;
  });

const parentOf = (row: Row | undefined) => (row ? { ownerId: row.ownerId, status: row.status } : null);

/** True when one `OR` branch passes: its own keys on the note, and its `deal` or `lead` filter on that parent. */
const branchMatches = (row: Row, branch: Row) => {
  const { deal: dealWhere, lead: leadWhere, ...own } = branch as Row & { deal?: Row; lead?: Row };
  if (!matches(row, own)) return false;
  if (dealWhere) {
    const parent = state.deals.find((d) => d.id === row.dealId);
    if (!parent || !matches(parent, dealWhere)) return false;
  }
  if (leadWhere) {
    const parent = state.leads.find((l) => l.id === row.leadId);
    if (!parent || !matches(parent, leadWhere)) return false;
  }
  return true;
};

const db = {
  salesDeal: {
    findFirst: vi.fn(async (args: Args) => state.deals.find((d) => matches(d, args.where)) ?? null),
  },
  salesLead: {
    findFirst: vi.fn(async (args: Args) => state.leads.find((l) => matches(l, args.where)) ?? null),
    // Like Postgres: the write lands only on rows that still match its `where`.
    updateMany: vi.fn(async (args: Args) => {
      const rows = state.leads.filter((l) => matches(l, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    }),
  },
  salesNote: {
    create: vi.fn(async (args: Args) => {
      const row = { id: "n-new", createdAt, updatedAt: createdAt, archivedAt: null, ...args.data };
      state.notes.push(row);
      return row;
    }),
    // The note with its deal and its lead (as Prisma's select gives them), when it and one `OR` branch pass the `where`.
    findFirst: vi.fn(async (args: Args) => {
      const { OR: branches, ...own } = args.where as Row & { OR: Row[] };
      const row = state.notes.find((n) => matches(n, own) && branches.some((branch) => branchMatches(n, branch)));
      if (!row) return null;
      return {
        ...row,
        deal: parentOf(state.deals.find((d) => d.id === row.dealId)),
        lead: parentOf(state.leads.find((l) => l.id === row.leadId)),
      };
    }),
    // Like Postgres: the write lands only on rows that still match its `where`.
    updateMany: vi.fn(async (args: Args) => {
      const rows = state.notes.filter((n) => matches(n, args.where));
      for (const row of rows) Object.assign(row, args.data, { updatedAt: editedAt });
      return { count: rows.length };
    }),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => state.audits.push(args.data)) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const addRoute = await import("@/app/api/sales/deals/[dealId]/notes/route");
const leadAddRoute = await import("@/app/api/sales/leads/[leadId]/notes/route");
const noteRoute = await import("@/app/api/sales/notes/[noteId]/route");
const { editNote } = await import("@/lib/sales/notes");
const { PermissionError } = await import("@/lib/permissions");

const BASE = "http://localhost/api/sales";
const HEADERS = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
const META = { ipAddress: "203.0.113.9", userAgent: null };

const add = (body: unknown, dealId = "d1", headers: Record<string, string> = {}) =>
  addRoute.POST(
    new Request(`${BASE}/deals/${dealId}/notes`, { method: "POST", body: JSON.stringify(body), headers: { ...HEADERS, ...headers } }),
    { params: Promise.resolve({ dealId }) },
  );
const addToLead = (body: unknown, leadId = "l1", headers: Record<string, string> = {}) =>
  leadAddRoute.POST(
    new Request(`${BASE}/leads/${leadId}/notes`, { method: "POST", body: JSON.stringify(body), headers: { ...HEADERS, ...headers } }),
    { params: Promise.resolve({ leadId }) },
  );
const edit = (body: unknown, noteId = "n1", headers: Record<string, string> = {}) =>
  noteRoute.PATCH(
    new Request(`${BASE}/notes/${noteId}`, { method: "PATCH", body: JSON.stringify(body), headers: { ...HEADERS, ...headers } }),
    { params: Promise.resolve({ noteId }) },
  );

const asActor = (actor: SalesActor) => requireSalesUserMock.mockResolvedValue(actor);
const writes = () => [
  ...db.salesLead.updateMany.mock.calls,
  ...db.salesNote.create.mock.calls,
  ...db.salesNote.updateMany.mock.calls,
  ...db.salesAuditLog.create.mock.calls,
];

beforeEach(() => {
  for (const delegate of Object.values(db)) {
    if (typeof delegate === "function") delegate.mockClear();
    else for (const fn of Object.values(delegate)) fn.mockClear();
  }
  state.deals = [deal("d1"), deal("d2", { ownerId: "x" })];
  state.leads = [lead("l1"), lead("l2", { ownerId: "x" })];
  state.notes = [];
  state.audits = [];
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

describe("POST /api/sales/deals/[dealId]/notes", () => {
  it.each([
    [{ body: "   " }, "Write something first."],
    [{ body: "" }, "Write something first."],
    [{}, "Write something first."],
    [{ body: "x".repeat(50_001) }, "Notes can be up to 50,000 characters."],
  ])("refuses %# with its message and writes nothing", async (body, message) => {
    const res = await add(body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("accepts a note of exactly 50,000 characters", async () => {
    const res = await add({ body: "x".repeat(50_000) });

    expect(res.status).toBe(201);
  });

  it("refuses an unknown key", async () => {
    const res = await add({ body: "Hello", pinned: true });

    expect(res.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("stores the text exactly as typed (plain text, never HTML) and records the note", async () => {
    const res = await add({ body: "<script>alert(1)</script>" });

    expect(res.status).toBe(201);
    expect(db.salesNote.create.mock.calls[0][0].data).toEqual({
      body: "<script>alert(1)</script>",
      authorId: "r",
      dealId: "d1",
    });
    expect(state.audits).toEqual([
      {
        actorType: "USER",
        actorId: "r",
        botTokenId: null,
        entityType: "SalesDeal",
        entityId: "d1",
        action: "note_added",
        before: undefined,
        after: { noteId: "n-new" },
        ...META,
      },
    ]);
    expect(await res.json()).toEqual({
      note: { id: "n-new", body: "<script>alert(1)</script>", createdAt: createdAt.toISOString() },
    });
    expect(db.salesDeal.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", archivedAt: null, ownerId: "r" });
  });

  it("trims the text around the note, keeping its inside lines", async () => {
    await add({ body: "\n  Called the front desk.\n\nCall back Tuesday.  \n" });

    expect(db.salesNote.create.mock.calls[0][0].data.body).toBe("Called the front desk.\n\nCall back Tuesday.");
  });

  it("answers 404 for a deal the person may not see, and 403 for one they see but do not own", async () => {
    const hidden = await add({ body: "Hello" }, "d2");
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Deal not found." });

    asActor(seesAll);
    const notOwner = await add({ body: "Hello" }, "d1");
    expect(notOwner.status).toBe(403);
    expect(await notOwner.json()).toEqual({ error: "Only the deal owner or an admin can change this deal." });

    expect(writes()).toEqual([]);
  });

  it("refuses someone without Sales access, and another site's request, before reading anything", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    expect((await add({ body: "Hello" })).status).toBe(403);

    asActor(rep);
    const blocked = await add({ body: "Hello" }, "d1", { origin: "https://evil.example" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "Request blocked." });

    expect(db.salesDeal.findFirst).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});

describe("editNote and PATCH /api/sales/notes/[noteId]", () => {
  beforeEach(() => {
    state.notes = [note("n1")];
  });

  it("refuses a non-author who is not an admin, even the deal owner", async () => {
    state.notes = [note("n1", { authorId: "x" })];
    const res = await edit({ body: "new" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the person who wrote this note or an admin can edit it." });
    expect(writes()).toEqual([]);
  });

  it("lets an admin edit someone else's note, keeping the old text in history", async () => {
    asActor(admin);
    const res = await edit({ body: "new" });

    expect(res.status).toBe(200);
    expect(db.salesNote.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "n1", archivedAt: null, updatedAt: createdAt },
      data: { body: "new" },
    });
    expect(state.audits).toEqual([
      {
        actorType: "USER",
        actorId: "b",
        botTokenId: null,
        entityType: "SalesDeal",
        entityId: "d1",
        action: "note_edited",
        before: { noteId: "n1", body: "old" },
        after: { noteId: "n1", body: "new" },
        ...META,
      },
    ]);
    expect(await res.json()).toEqual({ ok: true, changed: true, note: { id: "n1", body: "new" } });
  });

  it("lets the author edit their own note", async () => {
    const result = await editNote(rep, "n1", { body: "new" }, META);

    expect(result).toEqual({ ok: true, changed: true, note: { id: "n1", body: "new" } });
    expect(state.audits.map((row) => row.action)).toEqual(["note_edited"]);
  });

  it("changes nothing when the text is the same", async () => {
    const result = await editNote(rep, "n1", { body: "old" }, META);

    expect(result).toEqual({ ok: true, changed: false, note: { id: "n1", body: "old" } });
    expect(writes()).toEqual([]);
  });

  it("looks the note up through its deal's visibility, or its lead's while it has no deal", async () => {
    await editNote(rep, "n1", { body: "new" }, META);

    expect(db.salesNote.findFirst.mock.calls[0][0].where).toEqual({
      id: "n1",
      archivedAt: null,
      OR: [
        { dealId: { not: null }, deal: { archivedAt: null, ownerId: "r" } },
        { dealId: null, leadId: { not: null }, lead: { archivedAt: null, ownerId: "r" } },
      ],
    });
  });

  it("looks the note up through every deal and lead for someone who sees everyone's", async () => {
    asActor(seesAll);
    await edit({ body: "new" });

    expect(db.salesNote.findFirst.mock.calls[0][0].where).toEqual({
      id: "n1",
      archivedAt: null,
      OR: [
        { dealId: { not: null }, deal: { archivedAt: null } },
        { dealId: null, leadId: { not: null }, lead: { archivedAt: null } },
      ],
    });
  });

  it.each([
    ["a deal the person cannot see", note("n1", { dealId: "d2", authorId: "r" })],
    ["a note on another rep's lead", note("n1", { dealId: null, leadId: "l2" })],
    ["a removed note", note("n1", { archivedAt: createdAt })],
  ])("answers 404 for %s and writes nothing", async (_label, row) => {
    state.notes = [row];
    const res = await edit({ body: "new" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Note not found." });
    expect(writes()).toEqual([]);
  });

  it("answers a second, simultaneous save of the same edit as unchanged, with one history row in all", async () => {
    const write = db.salesNote.updateMany.getMockImplementation()!;
    db.salesNote.updateMany.mockImplementationOnce(async (args: Args) => {
      Object.assign(state.notes[0], { body: "new", updatedAt: editedAt });
      return write(args);
    });
    const result = await editNote(rep, "n1", { body: "new" }, META);

    expect(result).toEqual({ ok: true, changed: false, note: { id: "n1", body: "new" } });
    expect(db.salesNote.updateMany).toHaveBeenCalledTimes(1);
    expect(state.audits).toEqual([]);
  });

  it("records the text it replaced when another edit landed first", async () => {
    const write = db.salesNote.updateMany.getMockImplementation()!;
    db.salesNote.updateMany.mockImplementationOnce(async (args: Args) => {
      Object.assign(state.notes[0], { body: "middle", updatedAt: editedAt });
      return write(args);
    });
    const result = await editNote(rep, "n1", { body: "new" }, META);

    expect(result).toEqual({ ok: true, changed: true, note: { id: "n1", body: "new" } });
    expect(state.audits.map((row) => [row.before, row.after])).toEqual([
      [{ noteId: "n1", body: "middle" }, { noteId: "n1", body: "new" }],
    ]);
  });

  it("answers 409 and writes no history when the guarded write misses twice", async () => {
    db.salesNote.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    const result = await editNote(rep, "n1", { body: "new" }, META);

    expect(result).toEqual({ ok: false, status: 409, error: "This note just changed. Refresh and try again." });
    expect(state.audits).toEqual([]);
  });

  it.each([
    [{ body: "  " }, "Write something first."],
    [{ body: "x".repeat(50_001) }, "Notes can be up to 50,000 characters."],
  ])("refuses an edit to %# with its message", async (body, message) => {
    const res = await edit(body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message });
    expect(writes()).toEqual([]);
  });

  it("refuses someone without Sales access, and another site's request, before reading anything", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    expect((await edit({ body: "new" })).status).toBe(403);

    asActor(rep);
    const blocked = await edit({ body: "new" }, "n1", { origin: "https://evil.example" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "Request blocked." });

    expect(db.salesNote.findFirst).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});

describe("POST /api/sales/leads/[leadId]/notes", () => {
  it("adds a note to a lead", async () => {
    const res = await addToLead({ body: "Prefers mornings" });

    expect(res.status).toBe(201);
    expect(db.salesNote.create.mock.calls[0][0].data).toEqual({ body: "Prefers mornings", authorId: "r", leadId: "l1" });
    expect(state.audits).toEqual([
      {
        actorType: "USER",
        actorId: "r",
        botTokenId: null,
        entityType: "SalesLead",
        entityId: "l1",
        action: "note_added",
        before: undefined,
        after: { noteId: "n-new" },
        ...META,
      },
    ]);
    expect(await res.json()).toEqual({ note: { id: "n-new", body: "Prefers mornings", createdAt: createdAt.toISOString() } });
    expect(db.salesLead.findFirst.mock.calls[0][0].where).toEqual({ id: "l1", archivedAt: null, ownerId: "r" });
  });

  it.each([
    ["a converted lead", { status: "CONVERTED" }, rep, 409, "This lead was converted. Open its deal instead."],
    ["an archived lead", { status: "ARCHIVED" }, rep, 409, "This lead is archived. Restore it first."],
    ["a lead the person sees but does not own", {}, seesAll, 403, "Only the lead owner or an admin can change this lead."],
    ["a deleted lead", { archivedAt: createdAt }, rep, 404, "Lead not found."],
  ] as const)("refuses a note on %s and writes nothing", async (_label, change, actor, status, error) => {
    Object.assign(state.leads[0], change);
    asActor(actor);
    const res = await addToLead({ body: "Prefers mornings" });

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(writes()).toEqual([]);
  });

  it("answers 404 for a lead the person may not see, with no note and no row", async () => {
    const res = await addToLead({ body: "Prefers mornings" }, "l2");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Lead not found." });
    expect(writes()).toEqual([]);
  });

  it("takes the lead row before adding to it", async () => {
    const res = await addToLead({ body: "Prefers mornings" });

    expect(res.status).toBe(201);
    expect(db.salesLead.updateMany.mock.calls).toEqual([
      [{ where: { id: "l1", status: "OPEN", archivedAt: null, ownerId: "r" }, data: { updatedAt: expect.any(Date) } }],
    ]);
    expect(db.salesLead.updateMany.mock.invocationCallOrder[0]).toBeLessThan(db.salesNote.create.mock.invocationCallOrder[0]);
  });

  it("refuses when a convert takes the lead first, and adds nothing", async () => {
    const write = db.salesLead.updateMany.getMockImplementation()!;
    db.salesLead.updateMany.mockImplementationOnce(async (args: Args) => {
      Object.assign(state.leads[0], { status: "CONVERTED" });
      return write(args);
    });
    const res = await addToLead({ body: "Prefers mornings" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This lead was converted. Open its deal instead." });
    expect(db.salesNote.create).not.toHaveBeenCalled();
    expect(state.audits).toEqual([]);
  });

  it("refuses a bad body, someone without Sales access, and another site's request, before reading anything", async () => {
    const bad = await addToLead({ body: "  " });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Write something first." });

    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    expect((await addToLead({ body: "Hello" })).status).toBe(403);

    asActor(rep);
    const blocked = await addToLead({ body: "Hello" }, "l1", { origin: "https://evil.example" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "Request blocked." });

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.salesLead.findFirst).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});

describe("editing notes on leads (Decision 10)", () => {
  it("edits a lead note through its lead, and a moved note through its deal", async () => {
    state.notes = [note("n1", { dealId: null, leadId: "l1" })];
    const onLead = await edit({ body: "new" });

    expect(onLead.status).toBe(200);
    expect(await onLead.json()).toEqual({ ok: true, changed: true, note: { id: "n1", body: "new" } });
    expect(state.audits).toEqual([
      {
        actorType: "USER",
        actorId: "r",
        botTokenId: null,
        entityType: "SalesLead",
        entityId: "l1",
        action: "note_edited",
        before: { noteId: "n1", body: "old" },
        after: { noteId: "n1", body: "new" },
        ...META,
      },
    ]);

    // Moved to a deal by a convert: its deal decides, whatever the lead's status now.
    state.audits = [];
    state.leads[0].status = "CONVERTED";
    state.notes = [note("n2", { dealId: "d1", leadId: "l1" })];
    const result = await editNote(rep, "n2", { body: "newer" }, META);

    expect(result).toEqual({ ok: true, changed: true, note: { id: "n2", body: "newer" } });
    expect(state.audits.map((row) => [row.entityType, row.entityId, row.action])).toEqual([["SalesDeal", "d1", "note_edited"]]);
  });

  it.each([
    ["a converted", "CONVERTED", "This lead was converted. Open its deal instead."],
    ["an archived", "ARCHIVED", "This lead is archived. Restore it first."],
  ])("refuses to edit a note on %s lead (409) and writes nothing", async (_label, status, error) => {
    state.leads[0].status = status;
    state.notes = [note("n1", { dealId: null, leadId: "l1" })];
    const res = await edit({ body: "new" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error });
    expect(writes()).toEqual([]);
  });

  it("refuses a non-author on someone's lead note (403), before anything else", async () => {
    state.leads[0].status = "CONVERTED";
    state.notes = [note("n1", { dealId: null, leadId: "l1" })];
    const result = await editNote(seesAll, "n1", { body: "new" }, META);

    expect(result).toEqual({ ok: false, status: 403, error: "Only the person who wrote this note or an admin can edit it." });
    expect(writes()).toEqual([]);
  });

  it("edits through the deal when a convert moves the note just before the write", async () => {
    state.notes = [note("n1", { dealId: null, leadId: "l1" })];
    const write = db.salesNote.updateMany.getMockImplementation()!;
    db.salesNote.updateMany.mockImplementationOnce(async (args: Args) => {
      Object.assign(state.notes[0], { dealId: "d1" });
      return write(args);
    });
    const result = await editNote(rep, "n1", { body: "new" }, META);

    expect(db.salesNote.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "n1", archivedAt: null, updatedAt: createdAt, dealId: null },
      data: { body: "new" },
    });
    expect(db.salesNote.updateMany).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, changed: true, note: { id: "n1", body: "new" } });
    expect(state.audits.map((row) => [row.entityType, row.entityId, row.action])).toEqual([["SalesDeal", "d1", "note_edited"]]);
  });

  it("answers 404 for a note on a deleted lead", async () => {
    state.leads[0].archivedAt = createdAt;
    state.notes = [note("n1", { dealId: null, leadId: "l1" })];
    const result = await editNote(rep, "n1", { body: "new" }, META);

    expect(result).toEqual({ ok: false, status: 404, error: "Note not found." });
    expect(writes()).toEqual([]);
  });
});
