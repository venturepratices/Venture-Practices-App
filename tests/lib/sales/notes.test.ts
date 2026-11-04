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

const deal = (id: string, extra: Row = {}): Row => ({ id, ownerId: "r", archivedAt: null, ...extra });
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

const state = { deals: [] as Row[], notes: [] as Row[], audits: [] as Row[] };

/** A small `where` matcher: plain equality (dates by time) or `{ not: value }`. */
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, condition]) => {
    if (condition instanceof Date) return row[key] instanceof Date && (row[key] as Date).getTime() === condition.getTime();
    if (condition !== null && typeof condition === "object" && "not" in (condition as Row)) {
      return row[key] !== (condition as Row).not;
    }
    return row[key] === condition;
  });

const db = {
  salesDeal: {
    findFirst: vi.fn(async (args: Args) => state.deals.find((d) => matches(d, args.where)) ?? null),
  },
  salesNote: {
    create: vi.fn(async (args: Args) => {
      const row = { id: "n-new", createdAt, updatedAt: createdAt, archivedAt: null, ...args.data };
      state.notes.push(row);
      return row;
    }),
    // The note with its deal, when the note and the deal both pass the `where`.
    findFirst: vi.fn(async (args: Args) => {
      const { deal: dealWhere, ...own } = args.where as Row & { deal: Row };
      const row = state.notes.find((n) => matches(n, own));
      if (!row) return null;
      const parent = state.deals.find((d) => d.id === row.dealId);
      if (!parent || !matches(parent, dealWhere)) return null;
      return { ...row, deal: { ownerId: parent.ownerId } };
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
const edit = (body: unknown, noteId = "n1", headers: Record<string, string> = {}) =>
  noteRoute.PATCH(
    new Request(`${BASE}/notes/${noteId}`, { method: "PATCH", body: JSON.stringify(body), headers: { ...HEADERS, ...headers } }),
    { params: Promise.resolve({ noteId }) },
  );

const asActor = (actor: SalesActor) => requireSalesUserMock.mockResolvedValue(actor);
const writes = () => [
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

  it("looks the note up through its deal's visibility", async () => {
    await editNote(rep, "n1", { body: "new" }, META);

    expect(db.salesNote.findFirst.mock.calls[0][0].where).toEqual({
      id: "n1",
      archivedAt: null,
      dealId: { not: null },
      deal: { archivedAt: null, ownerId: "r" },
    });
  });

  it.each([
    ["a deal the person cannot see", note("n1", { dealId: "d2", authorId: "r" })],
    ["a note on a lead, not a deal", note("n1", { dealId: null, leadId: "l1" })],
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
