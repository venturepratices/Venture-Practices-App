import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Scheduling activities on a deal and ticking them done (or back to open),
// through their routes and the service, against a small fake database whose
// delegates record every call and a fake Sales gate. Checks who owns a new
// activity (Decision 15), the stored due time across the DST change (Review
// Focus 2), that a second tick writes nothing (Review Focus 4), and the exact
// locked history rows. Nothing here reaches a real database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; data: Row; select?: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;

const now = new Date("2026-11-05T15:00:00Z");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "s", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };

const { endOfDay } = await import("@/lib/utils");

const deal = (id: string, extra: Row = {}): Row => ({
  id,
  title: "Oak Creek Family Dentistry",
  ownerId: "r",
  personId: "pe1",
  status: "OPEN",
  archivedAt: null,
  ...extra,
});

const activity = (id: string, extra: Row = {}): Row => ({
  id,
  type: "CALL",
  subject: "First call",
  dueAt: endOfDay("2026-11-05"),
  hasTime: false,
  doneAt: null,
  ownerId: "r",
  dealId: "d1",
  leadId: null,
  createdBy: "r",
  archivedAt: null,
  ...extra,
});

const state = { deals: [] as Row[], activities: [] as Row[], audits: [] as Row[] };

/** A small `where` matcher: plain equality, `{ in: [...] }` or `{ not: value }`. */
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, condition]) => {
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      const c = condition as Row;
      if ("in" in c) return (c.in as unknown[]).includes(row[key]);
      if ("not" in c) return row[key] !== c.not;
    }
    return row[key] === condition;
  });

const db = {
  salesDeal: {
    findFirst: vi.fn(async (args: Args) => {
      const { id, archivedAt, ownerId } = args.where;
      const found = state.deals.find((d) => d.id === id);
      if (!found || (archivedAt === null && found.archivedAt !== null)) return null;
      if (ownerId !== undefined && found.ownerId !== ownerId) return null;
      return found;
    }),
  },
  salesActivity: {
    create: vi.fn(async (args: Args) => {
      const row = { id: "act-new", doneAt: null, archivedAt: null, ...args.data };
      state.activities.push(row);
      return row;
    }),
    // The activity with its deal, when the activity and the deal both pass the `where`.
    findFirst: vi.fn(async (args: Args) => {
      const { deal: dealWhere, ...own } = args.where as Row & { deal: Row };
      const row = state.activities.find((a) => matches(a, own));
      if (!row) return null;
      const parent = state.deals.find((d) => d.id === row.dealId);
      if (!parent || !matches(parent, dealWhere)) return null;
      return {
        ...row,
        deal: { id: parent.id, title: parent.title, status: parent.status, ownerId: parent.ownerId },
      };
    }),
    // Like Postgres: the write lands only on rows that still match its `where`.
    updateMany: vi.fn(async (args: Args) => {
      const rows = state.activities.filter((a) => matches(a, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    }),
    count: vi.fn(async (args: { where: Row }) => state.activities.filter((a) => matches(a, args.where)).length),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => state.audits.push(args.data)) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const createRoute = await import("@/app/api/sales/deals/[dealId]/activities/route");
const activityRoute = await import("@/app/api/sales/activities/[activityId]/route");
const { setActivityDone } = await import("@/lib/sales/activities");
const { PermissionError } = await import("@/lib/permissions");

const BASE = "http://localhost/api/sales";
const HEADERS = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
const META = { ipAddress: "203.0.113.9", userAgent: null };

const create = (body: unknown, dealId = "d1", headers: Record<string, string> = {}) =>
  createRoute.POST(
    new Request(`${BASE}/deals/${dealId}/activities`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { ...HEADERS, ...headers },
    }),
    { params: Promise.resolve({ dealId }) },
  );
const patch = (body: unknown, activityId = "a1", headers: Record<string, string> = {}) =>
  activityRoute.PATCH(
    new Request(`${BASE}/activities/${activityId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { ...HEADERS, ...headers },
    }),
    { params: Promise.resolve({ activityId }) },
  );

const asActor = (actor: SalesActor) => requireSalesUserMock.mockResolvedValue(actor);
const writes = () => [
  ...db.salesActivity.create.mock.calls,
  ...db.salesActivity.updateMany.mock.calls,
  ...db.salesAuditLog.create.mock.calls,
];

/** Another request commits `change` to the activity just before this one's guarded write (a double-click). */
const otherRequestCommitsFirst = (change: Row) => {
  const write = db.salesActivity.updateMany.getMockImplementation()!;
  db.salesActivity.updateMany.mockImplementationOnce(async (args: Args) => {
    Object.assign(state.activities[0], change);
    return write(args);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  for (const delegate of Object.values(db)) {
    if (typeof delegate === "function") delegate.mockClear();
    else for (const fn of Object.values(delegate)) fn.mockClear();
  }
  state.deals = [deal("d1"), deal("d2", { title: "Bright Smiles Ortho", ownerId: "x", personId: null })];
  state.activities = [];
  state.audits = [];
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/sales/deals/[dealId]/activities", () => {
  it("schedules an activity for the deal owner, named after its type when the subject is blank", async () => {
    const res = await create({ type: "CALL", subject: "  ", dueDate: "2026-11-06", dueTime: null });

    expect(res.status).toBe(201);
    expect(db.salesActivity.create.mock.calls[0][0].data).toEqual({
      type: "CALL",
      subject: "Call",
      dueAt: endOfDay("2026-11-06"),
      hasTime: false,
      ownerId: "r",
      createdBy: "r",
      dealId: "d1",
      personId: "pe1",
    });
    expect(state.audits).toEqual([
      {
        actorType: "USER",
        actorId: "r",
        botTokenId: null,
        entityType: "SalesDeal",
        entityId: "d1",
        action: "activity_added",
        before: undefined,
        after: {
          activityId: "act-new",
          type: "CALL",
          subject: "Call",
          dueAt: endOfDay("2026-11-06").toISOString(),
          hasTime: false,
          createdBy: "r",
        },
        ...META,
      },
    ]);
    expect(await res.json()).toEqual({
      activity: {
        id: "act-new",
        type: "CALL",
        subject: "Call",
        dueAt: endOfDay("2026-11-06").toISOString(),
        hasTime: false,
        createdBy: "r",
        ownerId: "r",
      },
    });
    expect(db.salesDeal.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", archivedAt: null, ownerId: "r" });
  });

  it("gives an activity an admin schedules on someone else's deal to the admin (Decision 15)", async () => {
    asActor(admin);
    const res = await create({ type: "MEETING", subject: "Demo", dueDate: "2026-11-06" });

    expect(res.status).toBe(201);
    expect(db.salesActivity.create.mock.calls[0][0].data).toMatchObject({ ownerId: "b", createdBy: "b", dealId: "d1" });
    expect(state.audits[0]).toMatchObject({ actorId: "b", action: "activity_added" });
  });

  it("keeps the trimmed subject and stores a chosen time in Eastern time across the DST change", async () => {
    const res = await create({ type: "MEETING", subject: "  Demo  ", dueDate: "2026-03-08", dueTime: "09:30" });

    expect(res.status).toBe(201);
    const data = db.salesActivity.create.mock.calls[0][0].data;
    expect(data.subject).toBe("Demo");
    expect((data.dueAt as Date).toISOString()).toBe("2026-03-08T13:30:00.000Z");
    expect(data.hasTime).toBe(true);
    expect(state.audits[0].after).toMatchObject({ dueAt: "2026-03-08T13:30:00.000Z", hasTime: true });
  });

  it.each([
    [{ type: "CALL", dueDate: "2026-11-06", dueTime: "24:00" }, "Pick a time from the list."],
    [{ type: "CALL", dueDate: "2026-11-06", dueTime: "9:30" }, "Pick a time from the list."],
    [{ type: "CALL", dueDate: "2026-02-30" }, "Enter a real date."],
    [{ type: "CALL", dueDate: "11/06/2026" }, "Enter a real date."],
    [{ type: "CALL" }, "Enter a real date."],
  ])("refuses %j with %s and writes nothing", async (body, message) => {
    const res = await create(body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it.each([
    [{ type: "LUNCHEON", dueDate: "2026-11-06" }],
    [{ type: "CALL", dueDate: "2026-11-06", ownerId: "x" }],
    [{ type: "CALL", subject: "x".repeat(201), dueDate: "2026-11-06" }],
  ])("refuses %j with 400 and writes nothing", async (body) => {
    const res = await create(body);

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("refuses a deal the person can see but does not own (403)", async () => {
    asActor(seesAll);
    const res = await create({ type: "CALL", dueDate: "2026-11-06" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the deal owner or an admin can change this deal." });
    expect(writes()).toEqual([]);
  });

  it("answers 404 for a deal the person may not see", async () => {
    const res = await create({ type: "CALL", dueDate: "2026-11-06" }, "d2");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Deal not found." });
    expect(writes()).toEqual([]);
  });

  it("refuses someone without Sales access, and another site's request, before reading anything", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const denied = await create({ type: "CALL", dueDate: "2026-11-06" });
    expect(denied.status).toBe(403);

    asActor(rep);
    const blocked = await create({ type: "CALL", dueDate: "2026-11-06" }, "d1", { origin: "https://evil.example" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "Request blocked." });

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.salesDeal.findFirst).not.toHaveBeenCalled();
  });
});

describe("setActivityDone", () => {
  beforeEach(() => {
    state.activities = [activity("a1")];
  });

  it("marks an activity done, records it and answers with the deal's open count", async () => {
    const result = await setActivityDone(rep, "a1", true, META, now);

    expect(db.salesActivity.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "a1", archivedAt: null, doneAt: null },
      data: { doneAt: now },
    });
    expect(state.audits).toEqual([
      {
        actorType: "USER",
        actorId: "r",
        botTokenId: null,
        entityType: "SalesDeal",
        entityId: "d1",
        action: "activity_done",
        before: undefined,
        after: { activityId: "a1", type: "CALL", subject: "First call" },
        ...META,
      },
    ]);
    expect(db.salesActivity.count.mock.calls[0][0]).toEqual({ where: { dealId: "d1", doneAt: null, archivedAt: null } });
    expect(result).toEqual({
      ok: true,
      changed: true,
      activity: { id: "a1", doneAt: now.toISOString() },
      deal: { id: "d1", title: "Oak Creek Family Dentistry", status: "OPEN", openActivityCount: 0 },
    });
  });

  it("counts the deal's other open activities, not done or removed ones", async () => {
    state.activities.push(
      activity("a2"),
      activity("a3", { doneAt: new Date("2026-11-01T15:00:00Z") }),
      activity("a4", { archivedAt: new Date("2026-11-01T15:00:00Z") }),
      activity("a5", { dealId: "d2" }),
    );
    const result = await setActivityDone(rep, "a1", true, META, now);

    expect(result).toMatchObject({ ok: true, deal: { openActivityCount: 1 } });
  });

  it("changes nothing when the activity is already done (Review Focus 4)", async () => {
    const doneAt = new Date("2026-11-04T15:00:00Z");
    state.activities = [activity("a1", { doneAt })];
    const result = await setActivityDone(rep, "a1", true, META, now);

    expect(result).toEqual({
      ok: true,
      changed: false,
      activity: { id: "a1", doneAt: doneAt.toISOString() },
      deal: { id: "d1", title: "Oak Creek Family Dentistry", status: "OPEN", openActivityCount: 0 },
    });
    expect(writes()).toEqual([]);
  });

  it("reopens a done activity", async () => {
    state.activities = [activity("a1", { doneAt: new Date("2026-11-04T15:00:00Z") })];
    const result = await setActivityDone(rep, "a1", false, META, now);

    expect(db.salesActivity.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "a1", archivedAt: null, doneAt: { not: null } },
      data: { doneAt: null },
    });
    expect(state.audits.map((row) => [row.action, row.after])).toEqual([
      ["activity_reopened", { activityId: "a1", type: "CALL", subject: "First call" }],
    ]);
    expect(result).toEqual({
      ok: true,
      changed: true,
      activity: { id: "a1", doneAt: null },
      deal: { id: "d1", title: "Oak Creek Family Dentistry", status: "OPEN", openActivityCount: 1 },
    });
  });

  it("changes nothing when an open activity is reopened", async () => {
    const result = await setActivityDone(rep, "a1", false, META, now);

    expect(result).toMatchObject({ ok: true, changed: false, activity: { id: "a1", doneAt: null } });
    expect(writes()).toEqual([]);
  });

  it("looks the activity up through its deal's visibility, so only a visible deal's activity is found", async () => {
    await setActivityDone(rep, "a1", true, META, now);

    expect(db.salesActivity.findFirst.mock.calls[0][0].where).toEqual({
      id: "a1",
      archivedAt: null,
      dealId: { not: null },
      deal: { archivedAt: null, ownerId: "r" },
    });
  });

  it.each([
    ["another rep's deal", activity("a1", { dealId: "d2", ownerId: "x" })],
    ["a lead-only activity", activity("a1", { dealId: null, leadId: "l1" })],
    ["an archived activity", activity("a1", { archivedAt: new Date("2026-11-01T15:00:00Z") })],
  ])("answers 404 for %s and writes nothing", async (_label, row) => {
    state.activities = [row];
    const result = await setActivityDone(rep, "a1", true, META, now);

    expect(result).toEqual({ ok: false, status: 404, error: "Activity not found." });
    expect(writes()).toEqual([]);
  });

  it("answers 404 for an activity on a deleted deal", async () => {
    state.deals[0].archivedAt = new Date("2026-11-01T15:00:00Z");
    const result = await setActivityDone(rep, "a1", true, META, now);

    expect(result).toEqual({ ok: false, status: 404, error: "Activity not found." });
    expect(writes()).toEqual([]);
  });

  it("refuses someone who can see the deal but does not own it (403)", async () => {
    const result = await setActivityDone(seesAll, "a1", true, META, now);

    expect(result).toEqual({ ok: false, status: 403, error: "Only the deal owner or an admin can change this deal." });
    expect(db.salesActivity.findFirst.mock.calls[0][0].where).toEqual({
      id: "a1",
      archivedAt: null,
      dealId: { not: null },
      deal: { archivedAt: null },
    });
    expect(writes()).toEqual([]);
  });

  it("lets an admin tick an activity on someone else's deal", async () => {
    const result = await setActivityDone(admin, "a1", true, META, now);

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(state.audits[0]).toMatchObject({ actorId: "b", action: "activity_done" });
  });

  it("answers a double-click's second tick as unchanged, with one history row in all (Review Focus 4)", async () => {
    otherRequestCommitsFirst({ doneAt: new Date("2026-11-05T14:59:59Z") });
    const result = await setActivityDone(rep, "a1", true, META, now);

    expect(result).toMatchObject({ ok: true, changed: false, activity: { id: "a1", doneAt: "2026-11-05T14:59:59.000Z" } });
    expect(db.salesActivity.updateMany).toHaveBeenCalledTimes(1);
    expect(db.salesActivity.findFirst).toHaveBeenCalledTimes(2);
    expect(state.audits).toEqual([]);
  });

  it("answers 409 and writes no history when the guarded write misses twice", async () => {
    db.salesActivity.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    const result = await setActivityDone(rep, "a1", true, META, now);

    expect(result).toEqual({ ok: false, status: 409, error: "This activity just changed. Refresh and try again." });
    expect(state.audits).toEqual([]);
  });
});

describe("PATCH /api/sales/activities/[activityId]", () => {
  beforeEach(() => {
    state.activities = [activity("a1")];
  });

  it("ticks the activity and records the request's IP", async () => {
    const res = await patch({ done: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      changed: true,
      activity: { id: "a1", doneAt: now.toISOString() },
      deal: { id: "d1", title: "Oak Creek Family Dentistry", status: "OPEN", openActivityCount: 0 },
    });
    expect(state.audits[0]).toMatchObject({ action: "activity_done", ipAddress: "203.0.113.9" });
  });

  it("answers 404 with the pinned message", async () => {
    const res = await patch({ done: true }, "missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Activity not found." });
  });

  it.each([[{ done: "yes" }], [{ done: true, subject: "Renamed" }], [{}]])(
    "refuses %j with 400 (only done can change in Plan 2)",
    async (body) => {
      const res = await patch(body);

      expect(res.status).toBe(400);
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);
    },
  );

  it("refuses someone without Sales access, and another site's request, before reading anything", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const denied = await patch({ done: true });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "You don't have access to Sales." });

    asActor(rep);
    const blocked = await patch({ done: true }, "a1", { origin: "null" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "Request blocked." });

    expect(db.salesActivity.findFirst).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});
