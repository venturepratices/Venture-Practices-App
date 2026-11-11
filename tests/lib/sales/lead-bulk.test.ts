import { beforeEach, describe, expect, it, vi } from "vitest";

// The Leads Inbox bulk bar: assign, archive, restore and delete many leads in
// one request, through the real route against a small fake database and a fake
// Sales gate. Each lead runs in its own transaction and gets its own result;
// a refusal of the whole request answers with one error. Nothing here reaches
// a real database or a real session.

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
const seesAll: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };

const lead = (id: string, extra: Row = {}): Row => ({
  id,
  title: `Lead ${id}`,
  ownerId: "r",
  source: "Referral",
  status: "OPEN",
  archivedAt: null,
  organizationId: null,
  personId: null,
  organization: null,
  person: null,
  ...extra,
});

const state = {
  salesMembers: new Set<string>(),
  leads: [] as Row[],
  activities: [] as Row[],
  audits: [] as Row[],
};

const selected = (row: Row, select?: Row) =>
  select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row;

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) =>
    value !== null && typeof value === "object" && "in" in value
      ? (value.in as unknown[]).includes(row[key])
      : row[key] === value,
  );

const db = {
  teamMember: {
    findFirst: vi.fn(async (args: Args) => (state.salesMembers.has(args.where.id as string) ? { id: args.where.id } : null)),
  },
  salesLead: {
    findFirst: vi.fn(async (args: Args) => {
      const row = state.leads.find((l) => matches(l, args.where));
      return row ? selected(row, args.select) : null;
    }),
    findMany: vi.fn(async (args: Args) => state.leads.filter((l) => matches(l, args.where)).map((l) => selected(l, args.select))),
    update: vi.fn(async (args: Args) => {
      const row = state.leads.find((l) => l.id === args.where.id);
      if (!row) throw new Error("Record to update not found.");
      Object.assign(row, args.data);
      return selected(row, args.select);
    }),
    updateMany: vi.fn(async (args: Args) => {
      const rows = state.leads.filter((l) => matches(l, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    }),
  },
  salesOrganization: { findFirst: vi.fn(async () => null) },
  salesPerson: { findFirst: vi.fn(async () => null) },
  salesActivity: {
    findMany: vi.fn(async (args: Args) => state.activities.filter((a) => matches(a, args.where)).map((a) => selected(a, args.select))),
    updateMany: vi.fn(async (args: Args) => {
      const rows = state.activities.filter((a) => matches(a, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    }),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => state.audits.push(args.data)) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const bulkRoute = await import("@/app/api/sales/leads/bulk/route");

const HEADERS = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
const bulk = (body: unknown) =>
  bulkRoute.POST(new Request("http://localhost/api/sales/leads/bulk", { method: "POST", body: JSON.stringify(body), headers: HEADERS }));

const asActor = (actor: SalesActor) => requireSalesUserMock.mockResolvedValue(actor);
const allReads = () => [
  ...db.teamMember.findFirst.mock.calls,
  ...db.salesLead.findFirst.mock.calls,
  ...db.salesLead.findMany.mock.calls,
];
const leadWrites = () => [...db.salesLead.update.mock.calls, ...db.salesLead.updateMany.mock.calls];

beforeEach(() => {
  for (const delegate of Object.values(db)) {
    if (typeof delegate === "function") delegate.mockClear();
    else for (const fn of Object.values(delegate)) fn.mockClear();
  }
  state.salesMembers = new Set(["r", "b", "z"]);
  state.leads = [];
  state.activities = [];
  state.audits = [];
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

describe("POST /api/sales/leads/bulk", () => {
  it("bounds the request", async () => {
    const tooMany = await bulk({ action: "archive", ids: Array.from({ length: 101 }, (_, i) => `l${i}`) });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toEqual({ error: "Pick up to 100 leads at a time." });

    const none = await bulk({ action: "archive", ids: [] });
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: "Pick at least one lead." });

    const longId = await bulk({ action: "archive", ids: ["x".repeat(65)] });
    expect(longId.status).toBe(400);
    expect(await longId.json()).toEqual({ error: "Invalid input." });

    const unknownAction = await bulk({ action: "convert", ids: ["l1"] });
    expect(unknownAction.status).toBe(400);
    expect(await unknownAction.json()).toEqual({ error: "Invalid input." });

    const extraKey = await bulk({ action: "archive", ids: ["l1"], ownerId: "b" });
    expect(extraKey.status).toBe(400);

    expect(allReads()).toEqual([]);

    state.leads = [lead("l1")];
    const twice = await bulk({ action: "archive", ids: ["l1", "l1"] });
    expect(twice.status).toBe(200);
    expect(await twice.json()).toEqual({ results: [{ id: "l1", ok: true }] });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(state.audits).toHaveLength(1);
  });

  it("assigns lead by lead, each in its own transaction", async () => {
    asActor(seesAll);
    state.leads = [lead("l1"), lead("l2", { ownerId: "b" })];
    state.activities = [{ id: "a1", leadId: "l1", dealId: null, ownerId: "r", doneAt: null, archivedAt: null }];
    const res = await bulk({ action: "assign", ids: ["l1", "l2"], ownerId: "b" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { id: "l1", ok: true },
        { id: "l2", ok: false, error: "Only the lead owner or an admin can change this lead." },
      ],
    });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(state.leads.map((l) => l.ownerId)).toEqual(["b", "b"]);
    expect(state.activities[0].ownerId).toBe("b");
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesLead",
        entityId: "l1",
        action: "owner_changed",
        before: { ownerId: "r" },
        after: { ownerId: "b", movedActivityIds: ["a1"] },
        ipAddress: "203.0.113.9",
      }),
    ]);
  });

  it("refuses the whole assign when the new owner has no Sales access", async () => {
    asActor(admin);
    state.leads = [lead("l1"), lead("l2")];
    const res = await bulk({ action: "assign", ids: ["l1", "l2"], ownerId: "x" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Choose a team member with Sales access." });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(leadWrites()).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it("archives and restores in bulk", async () => {
    state.leads = [lead("l1"), lead("l2")];
    const archived = await bulk({ action: "archive", ids: ["l1", "l2"] });

    expect(await archived.json()).toEqual({ results: [{ id: "l1", ok: true }, { id: "l2", ok: true }] });
    expect(state.leads.map((l) => l.status)).toEqual(["ARCHIVED", "ARCHIVED"]);
    expect(state.audits.map((row) => [row.entityId, row.action, row.before, row.after])).toEqual([
      ["l1", "status_changed", { status: "OPEN" }, { status: "ARCHIVED" }],
      ["l2", "status_changed", { status: "OPEN" }, { status: "ARCHIVED" }],
    ]);

    state.audits = [];
    const restored = await bulk({ action: "restore", ids: ["l1", "l2"] });
    expect(await restored.json()).toEqual({ results: [{ id: "l1", ok: true }, { id: "l2", ok: true }] });
    expect(state.leads.map((l) => l.status)).toEqual(["OPEN", "OPEN"]);
    expect(state.audits.map((row) => [row.entityId, row.action, row.before, row.after])).toEqual([
      ["l1", "status_changed", { status: "ARCHIVED" }, { status: "OPEN" }],
      ["l2", "status_changed", { status: "ARCHIVED" }, { status: "OPEN" }],
    ]);
  });

  it("names each lead it could not archive", async () => {
    state.leads = [lead("l1"), lead("l2", { status: "CONVERTED" }), lead("l3", { ownerId: "b" })];
    const res = await bulk({ action: "archive", ids: ["l1", "l2", "l3"] });

    expect(await res.json()).toEqual({
      results: [
        { id: "l1", ok: true },
        { id: "l2", ok: false, error: "This lead was converted. Open its deal instead." },
        { id: "l3", ok: false, error: "Lead not found." },
      ],
    });
  });

  it("a non-admin bulk delete is refused and logged", async () => {
    state.leads = [lead("l1"), lead("l9", { ownerId: "b" })];
    const refused = await bulk({ action: "delete", ids: ["l1", "l9"] });

    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Only an admin can delete leads." });
    expect(leadWrites()).toEqual([]);
    expect(state.leads.map((l) => l.archivedAt)).toEqual([null, null]);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      entityType: "SalesLead",
      entityId: "l1",
      action: "delete_refused",
      actorType: "USER",
      actorId: "r",
      ipAddress: "203.0.113.9",
    });

    asActor(admin);
    state.audits = [];
    const deleted = await bulk({ action: "delete", ids: ["l1", "l9"] });

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ results: [{ id: "l1", ok: true }, { id: "l9", ok: true }] });
    expect(state.leads.map((l) => l.archivedAt)).toEqual([expect.any(Date), expect.any(Date)]);
    expect(state.audits.map((row) => [row.entityId, row.action, row.before])).toEqual([
      ["l1", "archived", { archivedAt: null }],
      ["l9", "archived", { archivedAt: null }],
    ]);
  });

  it("blocks a bulk change sent from another site", async () => {
    asActor(admin);
    state.leads = [lead("l1")];
    const res = await bulkRoute.POST(
      new Request("http://localhost/api/sales/leads/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "delete", ids: ["l1"] }),
        headers: { ...HEADERS, origin: "https://evil.example" },
      }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(allReads()).toEqual([]);
    expect(state.audits).toEqual([]);
  });
});
