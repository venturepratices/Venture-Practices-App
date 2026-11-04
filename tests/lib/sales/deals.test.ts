import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Adding, editing and deleting deals through their routes, against a small fake
// database whose delegates record every call, and a fake Sales gate. Checks the
// exact rows written (the deal, its first activity, new organizations and
// people) and the locked history rows that go with them, in order. Nothing here
// reaches a real database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; data: Row; select?: Row; orderBy?: unknown; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;

const now = new Date("2026-11-05T15:00:00Z");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };

const PIPELINES: Row[] = [
  { id: "p1", key: "direct-mail", kind: "SALES", archivedAt: null },
  { id: "p3", key: "client-delivery", kind: "DELIVERY", archivedAt: null },
];
// Listed out of board order on purpose: the first stage is the one with the lowest position.
const STAGES: Row[] = [
  { id: "s2", pipelineId: "p1", name: "Proposal Sent", position: 2 },
  { id: "s1", pipelineId: "p1", name: "Lead In", position: 1 },
  { id: "s9", pipelineId: "p3", name: "Kickoff", position: 1 },
];

const baseDeal = (extra: Row = {}): Row => ({
  id: "d1",
  title: "Oak Creek Family Dentistry",
  ownerId: "r",
  valueCents: 0,
  mrrCents: 0,
  source: "Added by hand",
  status: "OPEN",
  archivedAt: null,
  stage: { requiresValue: false },
  ...extra,
});

const state = {
  salesMembers: new Set<string>(),
  organizations: [] as Row[],
  people: [] as Row[],
  deal: null as Row | null,
  activities: [] as Row[],
  audits: [] as Row[],
};

/** Only the selected keys of a row, like Prisma's `select`. */
const selected = (row: Row, select?: Row) =>
  select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row;

/** A contact lookup: same id, not archived, and the owner filter when there is one. */
const findContact = (rows: Row[], where: Row) =>
  rows.find(
    (row) =>
      row.id === where.id &&
      row.archivedAt === null &&
      (where.ownerId === undefined || row.ownerId === where.ownerId),
  ) ?? null;

const db = {
  teamMember: {
    findFirst: vi.fn(async (args: Args) => (state.salesMembers.has(args.where.id as string) ? { id: args.where.id } : null)),
  },
  salesPipeline: {
    findFirst: vi.fn(
      async (args: Args) => PIPELINES.find((p) => p.id === args.where.id && p.archivedAt === null) ?? null,
    ),
  },
  salesStage: {
    findFirst: vi.fn(async (args: Args) => {
      const rows = STAGES.filter((s) => s.pipelineId === args.where.pipelineId);
      const ordered = JSON.stringify(args.orderBy) === JSON.stringify({ position: "asc" })
        ? [...rows].sort((a, b) => (a.position as number) - (b.position as number))
        : rows;
      return ordered[0] ?? null;
    }),
  },
  salesOrganization: {
    findFirst: vi.fn(async (args: Args) => findContact(state.organizations, args.where)),
    create: vi.fn(async (args: Args) => ({ id: "org-new", ...args.data })),
  },
  salesPerson: {
    findFirst: vi.fn(async (args: Args) => findContact(state.people, args.where)),
    create: vi.fn(async (args: Args) => ({ id: "person-new", ...args.data })),
  },
  salesDeal: {
    create: vi.fn(async (args: Args) => selected({ id: "deal-new", ...args.data }, args.select)),
    findFirst: vi.fn(async (args: Args) => {
      const deal = state.deal;
      if (!deal || deal.id !== args.where.id || deal.archivedAt !== null) return null;
      if (args.where.ownerId !== undefined && deal.ownerId !== args.where.ownerId) return null;
      return deal;
    }),
    update: vi.fn(async (args: Args) => selected({ ...state.deal, ...args.data }, args.select)),
  },
  salesActivity: {
    create: vi.fn(async (args: Args) => ({ id: "act-new", ...args.data })),
    findMany: vi.fn(async (args: Args) =>
      state.activities.filter(
        (a) =>
          a.dealId === args.where.dealId &&
          a.ownerId === args.where.ownerId &&
          a.doneAt === null &&
          a.archivedAt === null,
      ),
    ),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => state.audits.push(args.data)) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const dealsRoute = await import("@/app/api/sales/deals/route");
const dealRoute = await import("@/app/api/sales/deals/[dealId]/route");
const { PermissionError } = await import("@/lib/permissions");
const { SALES_MEMBER_WHERE } = await import("@/lib/sales/access");
const { endOfDay } = await import("@/lib/utils");

const BASE = "http://localhost/api/sales";
const HEADERS = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
const ctx = (dealId: string) => ({ params: Promise.resolve({ dealId }) });

const post = (body: unknown) =>
  dealsRoute.POST(new Request(`${BASE}/deals`, { method: "POST", body: JSON.stringify(body), headers: HEADERS }));
const patch = (dealId: string, body: unknown) =>
  dealRoute.PATCH(
    new Request(`${BASE}/deals/${dealId}`, { method: "PATCH", body: JSON.stringify(body), headers: HEADERS }),
    ctx(dealId),
  );
const del = (dealId: string, headers: Record<string, string> = {}) =>
  dealRoute.DELETE(new Request(`${BASE}/deals/${dealId}`, { method: "DELETE", headers: { ...HEADERS, ...headers } }), ctx(dealId));

const asActor = (actor: SalesActor) => requireSalesUserMock.mockResolvedValue(actor);
const writes = () => [
  ...db.salesOrganization.create.mock.calls,
  ...db.salesPerson.create.mock.calls,
  ...db.salesDeal.create.mock.calls,
  ...db.salesDeal.update.mock.calls,
  ...db.salesActivity.create.mock.calls,
  ...db.salesActivity.updateMany.mock.calls,
  ...db.salesAuditLog.create.mock.calls,
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  for (const delegate of Object.values(db)) {
    if (typeof delegate === "function") delegate.mockClear();
    else for (const fn of Object.values(delegate)) fn.mockClear();
  }
  state.salesMembers = new Set(["r", "b", "z"]);
  state.organizations = [
    { id: "o1", name: "Bright Smiles Dental", ownerId: "r", archivedAt: null },
    { id: "o2", name: "Lakeside Ortho", ownerId: "b", archivedAt: null },
  ];
  state.people = [{ id: "pe1", name: "Dana W.", ownerId: "b", organizationId: null, archivedAt: null }];
  state.deal = null;
  state.activities = [];
  state.audits = [];
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

afterEach(() => {
  vi.useRealTimers();
});

const NEW_DEAL = {
  pipelineId: "p1",
  ownerId: "r",
  organization: { name: "Oak Creek Family Dentistry" },
  person: { name: "Mark T." },
  valueCents: 0,
  firstActivity: "call-tomorrow",
};

describe("POST /api/sales/deals", () => {
  it("refuses someone without Sales access and writes nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await post(NEW_DEAL);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have access to Sales." });
    expect(writes()).toEqual([]);
  });

  it("refuses a non-admin adding a deal for someone else", async () => {
    asActor({ ...rep, seesAllDeals: true });
    const res = await post({ ...NEW_DEAL, ownerId: "b" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You can only add deals for yourself." });
    expect(writes()).toEqual([]);
  });

  it("refuses an owner without Sales access", async () => {
    asActor(admin);
    const res = await post({ ...NEW_DEAL, ownerId: "x" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Choose a team member with Sales access." });
    expect(db.teamMember.findFirst.mock.calls[0][0]).toMatchObject({ where: { id: "x", ...SALES_MEMBER_WHERE } });
    expect(writes()).toEqual([]);
  });

  it("needs a person or an organization", async () => {
    const res = await post({ ...NEW_DEAL, organization: null, person: null });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add a person or an organization." });
    expect(writes()).toEqual([]);
  });

  it("refuses a delivery pipeline, and a pipeline that does not exist", async () => {
    const delivery = await post({ ...NEW_DEAL, pipelineId: "p3" });
    expect(delivery.status).toBe(400);
    expect(await delivery.json()).toEqual({ error: "Deals can't be added to a delivery pipeline yet." });

    const missing = await post({ ...NEW_DEAL, pipelineId: "gone" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "Pick a pipeline." });
    expect(writes()).toEqual([]);
  });

  it("caps the value at $10,000,000 and rejects unknown keys", async () => {
    const tooBig = await post({ ...NEW_DEAL, valueCents: 1_000_000_001 });
    expect(tooBig.status).toBe(400);
    expect(await tooBig.json()).toEqual({ error: "Values can be up to $10,000,000." });

    const extra = await post({ ...NEW_DEAL, colour: "red" });
    expect(extra.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("adds the deal with a new organization and person, its first call and four history rows", async () => {
    asActor(admin);
    const res = await post(NEW_DEAL);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ deal: { id: "deal-new", pipelineKey: "direct-mail" } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    expect(db.salesOrganization.create.mock.calls[0][0].data).toEqual({ name: "Oak Creek Family Dentistry", ownerId: "r" });
    expect(db.salesPerson.create.mock.calls[0][0].data).toEqual({ name: "Mark T.", ownerId: "r", organizationId: "org-new" });
    expect(db.salesDeal.create.mock.calls[0][0].data).toEqual({
      title: "Oak Creek Family Dentistry",
      pipelineId: "p1",
      stageId: "s1",
      ownerId: "r",
      organizationId: "org-new",
      personId: "person-new",
      valueCents: 0,
      mrrCents: 0,
      stageEnteredAt: now,
      source: "Added by hand",
    });
    expect(db.salesActivity.create.mock.calls[0][0].data).toEqual({
      type: "CALL",
      subject: "First call",
      dueAt: endOfDay("2026-11-06"),
      hasTime: false,
      ownerId: "r",
      dealId: "deal-new",
      createdBy: "z",
    });

    expect(state.audits.map((row) => [row.entityType, row.entityId, row.action])).toEqual([
      ["SalesOrganization", "org-new", "created"],
      ["SalesPerson", "person-new", "created"],
      ["SalesDeal", "deal-new", "created"],
      ["SalesDeal", "deal-new", "activity_added"],
    ]);
    for (const row of state.audits) {
      expect(row).toMatchObject({ actorType: "USER", actorId: "z", ipAddress: "203.0.113.9" });
    }
    expect(state.audits[0].after).toEqual({ name: "Oak Creek Family Dentistry", ownerId: "r" });
    expect(state.audits[1].after).toEqual({ name: "Mark T.", ownerId: "r", organizationId: "org-new" });
    expect(state.audits[2].after).toEqual({
      title: "Oak Creek Family Dentistry",
      pipelineId: "p1",
      stageId: "s1",
      stageName: "Lead In",
      ownerId: "r",
      valueCents: 0,
      mrrCents: 0,
      organizationId: "org-new",
      personId: "person-new",
      source: "Added by hand",
    });
    expect(state.audits[3].after).toEqual({
      activityId: "act-new",
      type: "CALL",
      subject: "First call",
      dueAt: endOfDay("2026-11-06").toISOString(),
      hasTime: false,
      createdBy: "z",
    });
  });

  it("uses an existing organization the person can see, with no organization history row", async () => {
    const res = await post({ ...NEW_DEAL, organization: { id: "o1" }, person: null, valueCents: 500_000, firstActivity: "demo-2-days" });

    expect(res.status).toBe(201);
    expect(db.salesOrganization.findFirst.mock.calls[0][0].where).toEqual({ id: "o1", archivedAt: null, ownerId: "r" });
    expect(db.salesOrganization.create).not.toHaveBeenCalled();
    expect(db.salesDeal.create.mock.calls[0][0].data).toMatchObject({
      title: "Bright Smiles Dental",
      organizationId: "o1",
      personId: null,
      valueCents: 500_000,
    });
    expect(db.salesActivity.create.mock.calls[0][0].data).toMatchObject({
      type: "MEETING",
      subject: "Demo",
      dueAt: endOfDay("2026-11-07"),
      createdBy: "r",
    });
    expect(state.audits.map((row) => [row.entityType, row.action])).toEqual([
      ["SalesDeal", "created"],
      ["SalesDeal", "activity_added"],
    ]);
  });

  it("names the deal after the person when there is no organization", async () => {
    const res = await post({ ...NEW_DEAL, organization: null, person: { name: "  Sarah K. " }, firstActivity: "call-today" });

    expect(res.status).toBe(201);
    expect(db.salesPerson.create.mock.calls[0][0].data).toEqual({ name: "Sarah K.", ownerId: "r", organizationId: null });
    expect(db.salesDeal.create.mock.calls[0][0].data).toMatchObject({ title: "Sarah K.", organizationId: null, personId: "person-new" });
    expect(db.salesActivity.create.mock.calls[0][0].data).toMatchObject({ dueAt: endOfDay("2026-11-05") });
  });

  it("refuses an organization or person the person cannot see, before writing anything", async () => {
    const org = await post({ ...NEW_DEAL, organization: { id: "o2" } });
    expect(org.status).toBe(400);
    expect(await org.json()).toEqual({ error: "That organization was not found." });

    // The new organization is not made when the person lookup then fails.
    const person = await post({ ...NEW_DEAL, person: { id: "pe1" } });
    expect(person.status).toBe(400);
    expect(await person.json()).toEqual({ error: "That person was not found." });
    expect(writes()).toEqual([]);
  });
});

describe("PATCH /api/sales/deals/[dealId]", () => {
  it("refuses someone who can see the deal but does not own it, and hides a deal they cannot see", async () => {
    state.deal = baseDeal({ ownerId: "b" });

    asActor(seesAll);
    const notYours = await patch("d1", { title: "Oak" });
    expect(notYours.status).toBe(403);
    expect(await notYours.json()).toEqual({ error: "Only the deal owner or an admin can change this deal." });

    asActor(rep);
    const hidden = await patch("d1", { title: "Oak" });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Deal not found." });
    expect(writes()).toEqual([]);
  });

  it("hands the deal to another owner and logs it", async () => {
    state.deal = baseDeal();
    const res = await patch("d1", { ownerId: "b" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deal: { id: "d1", title: "Oak Creek Family Dentistry", valueCents: 0, mrrCents: 0, ownerId: "b", source: "Added by hand" },
    });
    expect(db.salesDeal.update.mock.calls[0][0]).toMatchObject({ where: { id: "d1" } });
    expect(db.salesDeal.update.mock.calls[0][0].data).toEqual({ ownerId: "b", updatedAt: now });
    expect(db.salesActivity.updateMany).not.toHaveBeenCalled();
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesDeal",
        entityId: "d1",
        action: "owner_changed",
        before: { ownerId: "r" },
        after: { ownerId: "b" },
        ipAddress: "203.0.113.9",
      }),
    ]);
  });

  it("refuses a new owner without Sales access", async () => {
    state.deal = baseDeal();
    const res = await patch("d1", { ownerId: "x" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Choose a team member with Sales access." });
    expect(writes()).toEqual([]);
  });

  it("moves the old owner's open activities on the deal to the new owner (Decision 15)", async () => {
    state.deal = baseDeal();
    state.activities = [
      { id: "a1", dealId: "d1", ownerId: "r", doneAt: null, archivedAt: null },
      { id: "a2", dealId: "d1", ownerId: "z", doneAt: null, archivedAt: null },
      { id: "a3", dealId: "d1", ownerId: "r", doneAt: new Date("2026-11-04T15:00:00Z"), archivedAt: null },
    ];
    const res = await patch("d1", { ownerId: "b" });

    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.salesActivity.findMany.mock.calls[0][0].where).toEqual({
      dealId: "d1",
      ownerId: "r",
      doneAt: null,
      archivedAt: null,
    });
    expect(db.salesActivity.updateMany.mock.calls).toEqual([[{ where: { id: { in: ["a1"] } }, data: { ownerId: "b" } }]]);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "owner_changed",
      before: { ownerId: "r" },
      after: { ownerId: "b", movedActivityIds: ["a1"] },
    });
  });

  it("logs a value change as one row with both amounts", async () => {
    state.deal = baseDeal();
    const res = await patch("d1", { valueCents: 1440000, mrrCents: 120000 });

    expect(res.status).toBe(200);
    expect(db.salesDeal.update.mock.calls[0][0].data).toEqual({ valueCents: 1440000, mrrCents: 120000, updatedAt: now });
    expect(state.audits).toEqual([
      expect.objectContaining({
        action: "value_changed",
        before: { valueCents: 0, mrrCents: 0 },
        after: { valueCents: 1440000, mrrCents: 120000 },
      }),
    ]);
  });

  it("logs a rename and a source change as one updated row with only what changed", async () => {
    state.deal = baseDeal();
    const res = await patch("d1", { title: "  Oak Creek Dental ", source: "Referral", valueCents: 0 });

    expect(res.status).toBe(200);
    expect(db.salesDeal.update.mock.calls[0][0].data).toEqual({ title: "Oak Creek Dental", source: "Referral", updatedAt: now });
    expect(state.audits).toEqual([
      expect.objectContaining({
        action: "updated",
        before: { title: "Oak Creek Family Dentistry", source: "Added by hand" },
        after: { title: "Oak Creek Dental", source: "Referral" },
      }),
    ]);
  });

  it("writes value, owner and rename as separate rows in that order", async () => {
    state.deal = baseDeal();
    const res = await patch("d1", { title: "Oak Creek Dental", ownerId: "b", valueCents: 2_000_000, mrrCents: 150_000 });

    expect(res.status).toBe(200);
    expect(state.audits.map((row) => row.action)).toEqual(["value_changed", "owner_changed", "updated"]);
  });

  it("will not clear a value on a deal in a stage that needs one (Review Focus 1)", async () => {
    state.deal = baseDeal({ valueCents: 1440000, mrrCents: 120000, stage: { requiresValue: true } });
    const res = await patch("d1", { mrrCents: 0 });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "A deal in Proposal Sent needs a total value and a monthly value above $0.",
      code: "PROPOSAL_NEEDS_VALUE",
    });
    expect(writes()).toEqual([]);
  });

  it("caps values at $10,000,000 (Review Focus 3), rejects unknown keys and needs something to change", async () => {
    state.deal = baseDeal();

    const tooBig = await patch("d1", { valueCents: 1_000_000_001 });
    expect(tooBig.status).toBe(400);
    expect(await tooBig.json()).toEqual({ error: "Values can be up to $10,000,000." });

    expect((await patch("d1", { colour: "red" })).status).toBe(400);
    expect((await patch("d1", {})).status).toBe(400);
    expect((await patch("d1", { source: "Billboard" })).status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("answers 200 and writes nothing when nothing changes", async () => {
    state.deal = baseDeal();
    const res = await patch("d1", { title: "Oak Creek Family Dentistry", ownerId: "r", valueCents: 0 });

    expect(res.status).toBe(200);
    expect((await res.json()).deal).toEqual({
      id: "d1",
      title: "Oak Creek Family Dentistry",
      valueCents: 0,
      mrrCents: 0,
      ownerId: "r",
      source: "Added by hand",
    });
    expect(writes()).toEqual([]);
  });
});

describe("DELETE /api/sales/deals/[dealId]", () => {
  const refusedRow = {
    entityType: "SalesDeal",
    entityId: "d1",
    action: "delete_refused",
    actorType: "USER",
    actorId: "r",
    ipAddress: "203.0.113.9",
  };

  it("refuses a non-admin owner and logs the attempt (spec rule 6)", async () => {
    state.deal = baseDeal();
    const res = await del("d1");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only an admin can delete deals." });
    expect(db.salesDeal.update).not.toHaveBeenCalled();
    expect(state.audits).toEqual([expect.objectContaining(refusedRow)]);
  });

  it("refuses and logs a non-admin who can see the deal but does not own it", async () => {
    state.deal = baseDeal({ ownerId: "b" });
    asActor(seesAll);
    const res = await del("d1");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only an admin can delete deals." });
    expect(db.salesDeal.update).not.toHaveBeenCalled();
    expect(state.audits).toEqual([expect.objectContaining(refusedRow)]);
  });

  it("answers 404 with no history row for a deal the person cannot see", async () => {
    state.deal = baseDeal({ ownerId: "b" });
    const res = await del("d1");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Deal not found." });
    expect(db.salesDeal.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", archivedAt: null, ownerId: "r" });
    expect(writes()).toEqual([]);
  });

  it("archives the deal for an admin and logs it", async () => {
    state.deal = baseDeal();
    asActor(admin);
    const res = await del("d1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.salesDeal.update.mock.calls[0][0]).toMatchObject({ where: { id: "d1" }, data: { archivedAt: now } });
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesDeal",
        entityId: "d1",
        action: "archived",
        actorId: "z",
        before: { archivedAt: null },
        after: { archivedAt: now.toISOString() },
        ipAddress: "203.0.113.9",
      }),
    ]);
  });

  it("blocks a delete sent from another site, even for an admin", async () => {
    state.deal = baseDeal();
    asActor(admin);
    const res = await del("d1", { origin: "https://evil.example" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(db.salesDeal.findFirst).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});
