import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Converting a lead to a deal, one at a time from the lead panel and many at a
// time from the Leads Inbox bulk bar, through the real routes against a small
// fake database whose delegates record every call, and a fake Sales gate.
// Checks every refusal comes before the first write, the exact rows written,
// and the locked history rows that go with them, in order. Nothing here
// reaches a real database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; data: Row; select?: Row; orderBy?: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;

const now = new Date("2026-11-05T15:00:00Z");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };

/** A lead row as the fake stores it: open, not deleted, with its contacts (or none). */
const lead = (id: string, extra: Row = {}): Row => ({
  id,
  title: "Crestview Dental",
  ownerId: "r",
  source: "Referral",
  status: "OPEN",
  archivedAt: null,
  convertedDealId: null,
  organizationId: "o1",
  personId: "p1",
  organization: { id: "o1", name: "Crestview Dental" },
  person: { id: "p1", name: "Laura B." },
  ...extra,
});
const NO_CONTACTS = { organizationId: null, personId: null, organization: null, person: null };

const stage = (id: string, pipelineId: string, position: number, name: string, extra: Row = {}): Row => ({
  id,
  pipelineId,
  position,
  name,
  isWon: false,
  isLost: false,
  isNoShow: false,
  requiresValue: false,
  archivedAt: null,
  ...extra,
});

const state = {
  salesMembers: new Set<string>(),
  pipelines: [] as Row[],
  stages: [] as Row[],
  leads: [] as Row[],
  organizations: [] as Row[],
  people: [] as Row[],
  activities: [] as Row[],
  notes: [] as Row[],
  audits: [] as Row[],
  deals: 0,
  /** Runs before each guarded lead write; answering true makes it match nothing (another request changed the lead first). */
  raceGuardedWrite: null as null | (() => boolean),
  /** Makes the `convertedDealId` write fail the way Postgres does when that deal id is already taken. */
  convertedDealIdTaken: false,
};

/** Only the selected keys of a row, like Prisma's `select`. */
const selected = (row: Row, select?: Row) =>
  select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row;

/** Plain equality on every key of `where`, and `{ in: [...] }` lists. */
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) =>
    value !== null && typeof value === "object" && "in" in value
      ? (value.in as unknown[]).includes(row[key])
      : row[key] === value,
  );

/** Prisma's `orderBy: { position: "asc" }`, and the stored order when there is none. */
const ordered = (rows: Row[], orderBy?: Row) =>
  orderBy?.position === "asc" ? [...rows].sort((a, b) => (a.position as number) - (b.position as number)) : rows;

/** A contact lookup: same id, not archived, and the who-can-see `OR` when there is one (only `ownerId` branches here). */
const findContact = (rows: Row[], where: Row) => {
  const row = rows.find(
    (r) =>
      r.id === where.id &&
      r.archivedAt === null &&
      (where.OR === undefined || (where.OR as Row[]).some((branch) => "ownerId" in branch && r.ownerId === branch.ownerId)),
  );
  return row ? { id: row.id, name: row.name } : null;
};

const db = {
  teamMember: {
    findFirst: vi.fn(async (args: Args) => (state.salesMembers.has(args.where.id as string) ? { id: args.where.id } : null)),
  },
  salesPipeline: {
    findFirst: vi.fn(async (args: Args) => {
      const pipeline = state.pipelines.find((row) => matches(row, args.where));
      return pipeline ? selected(pipeline, args.select) : null;
    }),
    findMany: vi.fn(async (args: Args) => {
      const { stages: stageArgs, ...rest } = (args.select ?? {}) as Row & { stages?: Args };
      return ordered(state.pipelines.filter((row) => matches(row, args.where)), args.orderBy).map((pipeline) => {
        const out = selected(pipeline, rest);
        if (stageArgs) {
          out.stages = ordered(
            state.stages.filter((row) => row.pipelineId === pipeline.id && matches(row, stageArgs.where)),
            stageArgs.orderBy,
          ).map((row) => selected(row, stageArgs.select));
        }
        return out;
      });
    }),
  },
  salesStage: {
    findFirst: vi.fn(async (args: Args) => {
      const row = state.stages.find((s) => matches(s, args.where));
      return row ? selected(row, args.select) : null;
    }),
  },
  salesLead: {
    findFirst: vi.fn(async (args: Args) => {
      const row = state.leads.find((l) => matches(l, args.where));
      return row ? selected(row, args.select) : null;
    }),
    update: vi.fn(async (args: Args) => {
      if (state.convertedDealIdTaken && "convertedDealId" in args.data) {
        throw Object.assign(new Error("Unique constraint failed on the fields: (`convertedDealId`)"), { code: "P2002" });
      }
      const row = state.leads.find((l) => l.id === args.where.id);
      if (!row) throw new Error("Record to update not found.");
      Object.assign(row, args.data);
      return selected(row, args.select);
    }),
    updateMany: vi.fn(async (args: Args) => {
      if (state.raceGuardedWrite?.()) return { count: 0 };
      const rows = state.leads.filter((l) => matches(l, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    }),
  },
  salesOrganization: {
    findFirst: vi.fn(async (args: Args) => findContact(state.organizations, args.where)),
    create: vi.fn(async (args: Args) => selected({ id: "org-new", ...args.data }, args.select)),
  },
  salesPerson: {
    findFirst: vi.fn(async (args: Args) => findContact(state.people, args.where)),
    create: vi.fn(async (args: Args) => selected({ id: "person-new", ...args.data }, args.select)),
  },
  salesDeal: {
    create: vi.fn(async (args: Args) => {
      state.deals += 1;
      return selected({ id: `deal-${state.deals}`, ...args.data }, args.select);
    }),
  },
  salesActivity: {
    findMany: vi.fn(async (args: Args) => state.activities.filter((row) => matches(row, args.where)).map((row) => selected(row, args.select))),
    updateMany: vi.fn(async (args: Args) => {
      const rows = state.activities.filter((row) => matches(row, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    }),
    create: vi.fn(async (args: Args) => selected({ id: "act-new", ...args.data }, args.select)),
  },
  salesNote: {
    findMany: vi.fn(async (args: Args) => state.notes.filter((row) => matches(row, args.where)).map((row) => selected(row, args.select))),
    updateMany: vi.fn(async (args: Args) => {
      const rows = state.notes.filter((row) => matches(row, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    }),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => state.audits.push(args.data)) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txClient)),
};
/** What `$transaction` hands its callback: the same delegates, but not the `prisma` object itself. */
const txClient: Row = {};
Object.assign(txClient, db);
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const convertRoute = await import("@/app/api/sales/leads/[leadId]/convert/route");
const bulkRoute = await import("@/app/api/sales/leads/convert/route");
const { loadConvertTargets } = await import("@/lib/sales/lead-convert");
const { PermissionError } = await import("@/lib/permissions");
const { SALES_MEMBER_WHERE } = await import("@/lib/sales/access");
const { endOfDay } = await import("@/lib/utils");

const BASE = "http://localhost/api/sales";
const HEADERS = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };

const convert = (leadId: string, body: unknown, headers: Record<string, string> = {}) =>
  convertRoute.POST(
    new Request(`${BASE}/leads/${leadId}/convert`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { ...HEADERS, ...headers },
    }),
    { params: Promise.resolve({ leadId }) },
  );
const convertMany = (body: unknown) =>
  bulkRoute.POST(new Request(`${BASE}/leads/convert`, { method: "POST", body: JSON.stringify(body), headers: HEADERS }));

const asActor = (actor: SalesActor) => requireSalesUserMock.mockResolvedValue(actor);

/** Every write the fake saw, in the order it happened. */
const writeLog = () =>
  Object.entries({
    "salesOrganization.create": db.salesOrganization.create,
    "salesPerson.create": db.salesPerson.create,
    "salesLead.update": db.salesLead.update,
    "salesLead.updateMany": db.salesLead.updateMany,
    "salesDeal.create": db.salesDeal.create,
    "salesActivity.updateMany": db.salesActivity.updateMany,
    "salesActivity.create": db.salesActivity.create,
    "salesNote.updateMany": db.salesNote.updateMany,
    "salesAuditLog.create": db.salesAuditLog.create,
  })
    .flatMap(([name, fn]) => fn.mock.calls.map((call, i) => ({ name, args: call[0] as Row, order: fn.mock.invocationCallOrder[i] })))
    .sort((a, b) => a.order - b.order);
const writeNames = () => writeLog().map((write) => write.name);

/** Every read and write the fake saw. */
const allCalls = () =>
  Object.values(db).flatMap((delegate) =>
    typeof delegate === "function" ? delegate.mock.calls : Object.values(delegate).flatMap((fn) => fn.mock.calls),
  );

/** The history rows written, as entity, action and payload. */
const auditRows = () =>
  state.audits.map((row) => ({
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    ...(row.before === undefined ? {} : { before: row.before }),
    ...(row.after === undefined ? {} : { after: row.after }),
  }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  for (const delegate of Object.values(db)) {
    if (typeof delegate === "function") delegate.mockClear();
    else for (const fn of Object.values(delegate)) fn.mockClear();
  }
  state.salesMembers = new Set(["r", "b", "z"]);
  // Stored out of position order, so only an `orderBy` puts them in board order.
  state.pipelines = [
    { id: "pd", key: "delivery", name: "Delivery", kind: "DELIVERY", position: 3, archivedAt: null },
    { id: "pm2", key: "consulting", name: "Consulting", kind: "CONSULTING", position: 2, archivedAt: null },
    { id: "pm1", key: "direct-mail", name: "Direct Mail", kind: "SALES", position: 1, archivedAt: null },
    { id: "pmx", key: "old-sales", name: "Old Sales", kind: "SALES", position: 0, archivedAt: new Date("2026-10-01T15:00:00Z") },
  ];
  state.stages = [
    stage("s9", "pm1", 9, "Deal Lost Nurture", { isLost: true }),
    stage("s7", "pm1", 7, "Contract Signed", { isWon: true }),
    stage("s5", "pm1", 5, "Proposal Sent", { requiresValue: true }),
    stage("s4", "pm1", 4, "Old Stage", { archivedAt: new Date("2026-10-01T15:00:00Z") }),
    stage("s3", "pm1", 3, "No Show", { isNoShow: true }),
    stage("s2", "pm1", 2, "Demo Scheduled"),
    stage("s1", "pm1", 1, "New Opt-In"),
    stage("c1", "pm2", 1, "Discovery"),
    stage("d1", "pd", 1, "Kickoff"),
  ];
  state.leads = [
    lead("l1"),
    lead("l2", { title: "Bright Smile Dental", source: "Outbound", ...NO_CONTACTS }),
    lead("l3", { title: "Lakeside Ortho", ownerId: "b" }),
  ];
  state.organizations = [{ id: "o1", name: "Crestview Dental", ownerId: "r", archivedAt: null }];
  state.people = [{ id: "p1", name: "Laura B.", ownerId: "r", archivedAt: null }];
  state.activities = [
    { id: "a1", leadId: "l1", dealId: null, doneAt: null, archivedAt: null, ownerId: "r" },
    // Done and removed activities stay where they are.
    { id: "a2", leadId: "l1", dealId: null, doneAt: new Date("2026-11-04T15:00:00Z"), archivedAt: null, ownerId: "r" },
    { id: "a3", leadId: "l1", dealId: null, doneAt: null, archivedAt: new Date("2026-11-04T15:00:00Z"), ownerId: "r" },
  ];
  state.notes = [
    { id: "n1", leadId: "l1", dealId: null, archivedAt: null },
    { id: "n2", leadId: "l1", dealId: null, archivedAt: null },
    { id: "n3", leadId: "l1", dealId: null, archivedAt: new Date("2026-11-04T15:00:00Z") },
  ];
  state.audits = [];
  state.deals = 0;
  state.raceGuardedWrite = null;
  state.convertedDealIdTaken = false;
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/sales/leads/[leadId]/convert", () => {
  it("refuses someone without Sales access, a foreign Origin and unknown keys, and touches nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const noAccess = await convert("l1", { pipelineId: "pm1", stageId: "s1" });
    expect(noAccess.status).toBe(403);
    expect(await noAccess.json()).toEqual({ error: "You don't have access to Sales." });

    asActor(rep);
    const foreign = await convert("l1", { pipelineId: "pm1", stageId: "s1" }, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "Request blocked." });

    const extra = await convert("l1", { pipelineId: "pm1", stageId: "s1", ownerId: "b" });
    expect(extra.status).toBe(400);

    expect(allCalls()).toEqual([]);
  });

  it("converts with everything moving to the deal", async () => {
    const res = await convert("l1", { pipelineId: "pm1", stageId: "s1" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ deal: { id: "deal-1", pipelineKey: "direct-mail", pipelineName: "Direct Mail" } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    expect(writeNames()).toEqual([
      "salesLead.updateMany",
      "salesDeal.create",
      "salesLead.update",
      "salesActivity.updateMany",
      "salesNote.updateMany",
      "salesAuditLog.create",
      "salesAuditLog.create",
    ]);
    expect(db.salesLead.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "l1", status: "OPEN", archivedAt: null, ownerId: "r" },
      data: { status: "CONVERTED" },
    });
    expect(db.salesDeal.create.mock.calls[0][0].data).toEqual({
      title: "Crestview Dental",
      pipelineId: "pm1",
      stageId: "s1",
      ownerId: "r",
      organizationId: "o1",
      personId: "p1",
      valueCents: 0,
      mrrCents: 0,
      source: "Referral",
      stageEnteredAt: now,
    });
    expect(db.salesLead.update.mock.calls[0][0]).toMatchObject({ where: { id: "l1" }, data: { convertedDealId: "deal-1" } });

    expect(db.salesActivity.findMany.mock.calls[0][0].where).toEqual({ leadId: "l1", dealId: null, doneAt: null, archivedAt: null });
    expect(db.salesActivity.updateMany.mock.calls[0][0]).toEqual({ where: { id: { in: ["a1"] } }, data: { dealId: "deal-1" } });
    expect(db.salesNote.findMany.mock.calls[0][0].where).toEqual({ leadId: "l1", dealId: null, archivedAt: null });
    expect(db.salesNote.updateMany.mock.calls[0][0]).toEqual({ where: { id: { in: ["n1", "n2"] } }, data: { dealId: "deal-1" } });
    // The lead link stays on what moved; done and removed activities, and removed notes, stay on the lead.
    expect(state.activities.map((a) => [a.id, a.leadId, a.dealId])).toEqual([
      ["a1", "l1", "deal-1"],
      ["a2", "l1", null],
      ["a3", "l1", null],
    ]);
    expect(state.notes.map((n) => [n.id, n.leadId, n.dealId])).toEqual([
      ["n1", "l1", "deal-1"],
      ["n2", "l1", "deal-1"],
      ["n3", "l1", null],
    ]);
    expect(db.salesActivity.create).not.toHaveBeenCalled();

    expect(auditRows()).toEqual([
      {
        entityType: "SalesDeal",
        entityId: "deal-1",
        action: "created",
        after: {
          title: "Crestview Dental",
          pipelineId: "pm1",
          stageId: "s1",
          stageName: "New Opt-In",
          ownerId: "r",
          valueCents: 0,
          mrrCents: 0,
          organizationId: "o1",
          personId: "p1",
          source: "Referral",
          fromLeadId: "l1",
          movedActivityIds: ["a1"],
          movedNoteIds: ["n1", "n2"],
        },
      },
      { entityType: "SalesLead", entityId: "l1", action: "converted", after: { dealId: "deal-1" } },
    ]);
    expect(state.audits.every((row) => row.actorType === "USER" && row.actorId === "r" && row.ipAddress === "203.0.113.9")).toBe(true);
    expect(state.leads[0]).toMatchObject({ status: "CONVERTED", convertedDealId: "deal-1" });
  });

  it("keeps the lead's own contacts, whatever else is sent", async () => {
    const res = await convert("l1", { pipelineId: "pm1", stageId: "s1", person: { name: "Dana Q." }, organization: null });

    expect(res.status).toBe(201);
    expect(db.salesPerson.create).not.toHaveBeenCalled();
    expect(db.salesPerson.findFirst).not.toHaveBeenCalled();
    expect(db.salesDeal.create.mock.calls[0][0].data).toMatchObject({ organizationId: "o1", personId: "p1" });
  });

  it("adds the first call when nothing moves", async () => {
    state.activities = state.activities.filter((a) => a.id !== "a1");
    asActor(admin);
    const res = await convert("l1", { pipelineId: "pm1", stageId: "s2" });

    expect(res.status).toBe(201);
    expect(db.salesActivity.updateMany).not.toHaveBeenCalled();
    expect(db.salesActivity.create.mock.calls[0][0].data).toEqual({
      type: "CALL",
      subject: "First call after conversion",
      dueAt: endOfDay("2026-11-05"),
      hasTime: false,
      ownerId: "r",
      dealId: "deal-1",
      personId: "p1",
      createdBy: "z",
    });
    expect(auditRows().map((row) => `${row.entityType} ${row.action}`)).toEqual([
      "SalesDeal created",
      "SalesDeal activity_added",
      "SalesLead converted",
    ]);
    expect(auditRows()[0].after).toMatchObject({ ownerId: "r", movedActivityIds: [], movedNoteIds: ["n1", "n2"] });
    expect(auditRows()[1]).toEqual({
      entityType: "SalesDeal",
      entityId: "deal-1",
      action: "activity_added",
      after: {
        activityId: "act-new",
        type: "CALL",
        subject: "First call after conversion",
        dueAt: endOfDay("2026-11-05").toISOString(),
        hasTime: false,
        createdBy: "z",
      },
    });
  });

  it("converts once when clicked twice", async () => {
    // The other click committed first: by the time this one writes, the lead is converted.
    state.raceGuardedWrite = () => {
      state.leads[0].status = "CONVERTED";
      return true;
    };
    const twice = await convert("l1", { pipelineId: "pm1", stageId: "s1" });
    expect(twice.status).toBe(409);
    expect(await twice.json()).toEqual({ error: "This lead was already converted." });
    expect(db.salesDeal.create).not.toHaveBeenCalled();
    expect(writeNames()).toEqual(["salesLead.updateMany"]);

    // A lead with no contacts, converted with a new person: the miss comes before the person is made.
    for (const fn of Object.values(db.salesLead)) fn.mockClear();
    state.raceGuardedWrite = () => {
      state.leads[1].status = "CONVERTED";
      return true;
    };
    const withPerson = await convert("l2", { pipelineId: "pm1", stageId: "s1", person: { name: "Laura B." } });
    expect(withPerson.status).toBe(409);
    expect(await withPerson.json()).toEqual({ error: "This lead was already converted." });
    expect(db.salesPerson.create).not.toHaveBeenCalled();
    expect(db.salesAuditLog.create).not.toHaveBeenCalled();
    expect(db.salesDeal.create).not.toHaveBeenCalled();

    // The deal id already taken on a lead (the unique key): a 409, not a 500.
    state.raceGuardedWrite = null;
    state.leads = [lead("l1")];
    state.convertedDealIdTaken = true;
    const taken = await convert("l1", { pipelineId: "pm1", stageId: "s1" });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "This lead was already converted." });
  });

  it("a lead given away while it converts is refused", async () => {
    asActor(seesAll);
    // An admin gave the lead to z a moment before this convert wrote.
    state.raceGuardedWrite = () => {
      state.leads[0].ownerId = "z";
      return true;
    };
    const res = await convert("l1", { pipelineId: "pm1", stageId: "s1" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the lead owner or an admin can change this lead." });
    expect(db.salesLead.updateMany.mock.calls[0][0].where).toEqual({ id: "l1", status: "OPEN", archivedAt: null, ownerId: "r" });
    expect(writeNames()).toEqual(["salesLead.updateMany"]);
    expect(state.audits).toEqual([]);
  });

  it("answers 409 when the lead keeps changing", async () => {
    state.raceGuardedWrite = () => true;
    const res = await convert("l1", { pipelineId: "pm1", stageId: "s1" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This lead just changed. Refresh and try again." });
    expect(db.salesLead.updateMany).toHaveBeenCalledTimes(2);
    expect(writeNames()).toEqual(["salesLead.updateMany", "salesLead.updateMany"]);
  });

  it("refuses before writing anything", async () => {
    const res = await convert("l2", { pipelineId: "pm1", stageId: "s5", person: { name: "Laura B." } });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      code: "PROPOSAL_NEEDS_VALUE",
      error: "Add the total value and monthly value before moving to Proposal Sent.",
    });
    expect(db.salesLead.updateMany).not.toHaveBeenCalled();
    expect(db.salesPerson.create).not.toHaveBeenCalled();
    expect(db.salesAuditLog.create).not.toHaveBeenCalled();
    expect(writeLog()).toEqual([]);
  });

  it("never lands on a won, lost or No Show stage", async () => {
    for (const stageId of ["s3", "s7", "s9", "s4", "c1", "nope"]) {
      const res = await convert("l1", { pipelineId: "pm1", stageId });
      expect(res.status, stageId).toBe(400);
      expect(await res.json(), stageId).toEqual({ error: "Pick a stage from the list." });
    }
    expect(db.salesStage.findFirst.mock.calls[0][0].where).toEqual({
      id: "s3",
      pipelineId: "pm1",
      archivedAt: null,
      isWon: false,
      isLost: false,
      isNoShow: false,
    });

    const delivery = await convert("l1", { pipelineId: "pd", stageId: "d1" });
    expect(delivery.status).toBe(400);
    expect(await delivery.json()).toEqual({ error: "Deals can't be added to a delivery pipeline yet." });

    for (const pipelineId of ["pmx", "nope"]) {
      const gone = await convert("l1", { pipelineId, stageId: "s1" });
      expect(gone.status).toBe(400);
      expect(await gone.json()).toEqual({ error: "Pick a pipeline." });
    }

    expect(writeLog()).toEqual([]);
  });

  it("asks for both values at Proposal Sent", async () => {
    const onlyTotal = await convert("l1", { pipelineId: "pm1", stageId: "s5", valueCents: 1_440_000 });
    expect(onlyTotal.status).toBe(422);
    expect(await onlyTotal.json()).toEqual({
      code: "PROPOSAL_NEEDS_VALUE",
      error: "Add the total value and monthly value before moving to Proposal Sent.",
    });
    expect(writeLog()).toEqual([]);

    const both = await convert("l1", { pipelineId: "pm1", stageId: "s5", valueCents: 1_440_000, mrrCents: 120_000 });
    expect(both.status).toBe(201);
    expect(db.salesDeal.create.mock.calls[0][0].data).toMatchObject({ stageId: "s5", valueCents: 1_440_000, mrrCents: 120_000 });
    expect(auditRows()[0].after).toMatchObject({ stageName: "Proposal Sent", valueCents: 1_440_000, mrrCents: 120_000 });
  });

  it("checks the money it is given", async () => {
    for (const valueCents of [-1, 1.5, 1_000_000_001, "100"]) {
      const res = await convert("l1", { pipelineId: "pm1", stageId: "s1", valueCents });
      expect(res.status, String(valueCents)).toBe(400);
    }
    expect(allCalls()).toEqual([]);
  });

  it("needs a person or an organization", async () => {
    const none = await convert("l2", { pipelineId: "pm1", stageId: "s1" });
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: "Add a person or an organization." });
    const nulls = await convert("l2", { pipelineId: "pm1", stageId: "s1", person: null, organization: null });
    expect(nulls.status).toBe(400);
    expect(writeLog()).toEqual([]);

    // Converted by an admin: the new person still belongs to the lead owner.
    asActor(admin);
    const res = await convert("l2", { pipelineId: "pm1", stageId: "s1", person: { name: "Laura B." } });
    expect(res.status).toBe(201);
    expect(db.salesPerson.create.mock.calls[0][0].data).toEqual({
      name: "Laura B.",
      ownerId: "r",
      organizationId: null,
      nameKey: "laurab",
      emailKey: null,
      phoneKey: null,
    });
    expect(db.salesDeal.create.mock.calls[0][0].data).toMatchObject({
      title: "Bright Smile Dental",
      ownerId: "r",
      organizationId: null,
      personId: "person-new",
      source: "Outbound",
    });
    expect(writeNames().slice(0, 3)).toEqual(["salesLead.updateMany", "salesPerson.create", "salesAuditLog.create"]);
    expect(auditRows().map((row) => `${row.entityType} ${row.action}`)).toEqual([
      "SalesPerson created",
      "SalesDeal created",
      "SalesDeal activity_added",
      "SalesLead converted",
    ]);
  });

  it("refuses a picked contact the person cannot see", async () => {
    state.organizations.push({ id: "o8", name: "Lakeside Ortho", ownerId: "b", archivedAt: null });
    const res = await convert("l2", { pipelineId: "pm1", stageId: "s1", organization: { id: "o8" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That organization was not found." });
    expect(writeLog()).toEqual([]);
  });

  it("refuses archived leads, departed owners and other people's leads", async () => {
    state.leads.push(lead("l4", { status: "ARCHIVED" }), lead("l5", { ownerId: "x" }), lead("l6", { status: "CONVERTED", convertedDealId: "d9" }));

    const archived = await convert("l4", { pipelineId: "pm1", stageId: "s1" });
    expect(archived.status).toBe(409);
    expect(await archived.json()).toEqual({ error: "This lead is archived. Restore it first." });

    const converted = await convert("l6", { pipelineId: "pm1", stageId: "s1" });
    expect(converted.status).toBe(409);
    expect(await converted.json()).toEqual({ error: "This lead was already converted." });

    asActor(admin);
    const departed = await convert("l5", { pipelineId: "pm1", stageId: "s1" });
    expect(departed.status).toBe(400);
    expect(await departed.json()).toEqual({
      error: "The lead's owner no longer has Sales access. Give the lead to someone else first.",
    });
    expect(db.teamMember.findFirst.mock.calls.at(-1)?.[0]).toMatchObject({ where: { id: "x", ...SALES_MEMBER_WHERE } });

    asActor(seesAll);
    const notYours = await convert("l3", { pipelineId: "pm1", stageId: "s1" });
    expect(notYours.status).toBe(403);
    expect(await notYours.json()).toEqual({ error: "Only the lead owner or an admin can change this lead." });

    asActor(rep);
    const hidden = await convert("l3", { pipelineId: "pm1", stageId: "s1" });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Lead not found." });

    // Deleted: not found even for an admin.
    state.leads.push(lead("l7", { archivedAt: new Date("2026-11-01T15:00:00Z") }));
    asActor(admin);
    const deleted = await convert("l7", { pipelineId: "pm1", stageId: "s1" });
    expect(deleted.status).toBe(404);

    expect(writeLog()).toEqual([]);
  });
});

describe("POST /api/sales/leads/convert", () => {
  it("converts many, one transaction each", async () => {
    const tooMany = await convertMany({ ids: Array.from({ length: 26 }, (_, i) => `l${i}`), pipelineId: "pm1", stageId: "s1" });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toEqual({ error: "Convert up to 25 leads at a time." });

    const long = "x".repeat(65);
    for (const body of [
      { ids: [long], pipelineId: "pm1", stageId: "s1" },
      { ids: ["l1"], pipelineId: "pm1", stageId: long },
      { ids: ["l1"], pipelineId: long, stageId: "s1" },
    ]) {
      const res = await convertMany(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid input." });
    }
    expect(allCalls()).toEqual([]);

    const needsValue = await convertMany({ ids: ["l1"], pipelineId: "pm1", stageId: "s5" });
    expect(needsValue.status).toBe(400);
    expect(await needsValue.json()).toEqual({ error: "Pick a stage that does not need a value." });
    const won = await convertMany({ ids: ["l1"], pipelineId: "pm1", stageId: "s7" });
    expect(won.status).toBe(400);
    expect(await won.json()).toEqual({ error: "Pick a stage from the list." });
    const delivery = await convertMany({ ids: ["l1"], pipelineId: "pd", stageId: "d1" });
    expect(delivery.status).toBe(400);
    expect(await delivery.json()).toEqual({ error: "Deals can't be added to a delivery pipeline yet." });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writeLog()).toEqual([]);

    asActor(seesAll);
    const res = await convertMany({ ids: ["l1", "l2", "l3", "l1"], pipelineId: "pm1", stageId: "s1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { id: "l1", ok: true, dealId: "deal-1" },
        { id: "l2", ok: false, error: "Add a person or an organization." },
        { id: "l3", ok: false, error: "Only the lead owner or an admin can change this lead." },
      ],
      pipeline: { key: "direct-mail", name: "Direct Mail" },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(db.salesDeal.create).toHaveBeenCalledTimes(1);
    expect(auditRows().map((row) => `${row.entityType} ${row.entityId} ${row.action}`)).toEqual([
      "SalesDeal deal-1 created",
      "SalesLead l1 converted",
    ]);
  });

  it("refuses someone without Sales access and reads nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await convertMany({ ids: ["l1"], pipelineId: "pm1", stageId: "s1" });

    expect(res.status).toBe(403);
    expect(allCalls()).toEqual([]);
  });
});

describe("GET /api/sales/leads/convert", () => {
  const expected = [
    {
      id: "pm1",
      key: "direct-mail",
      name: "Direct Mail",
      stages: [
        { id: "s1", name: "New Opt-In", requiresValue: false },
        { id: "s2", name: "Demo Scheduled", requiresValue: false },
        { id: "s5", name: "Proposal Sent", requiresValue: true },
      ],
    },
    { id: "pm2", key: "consulting", name: "Consulting", stages: [{ id: "c1", name: "Discovery", requiresValue: false }] },
  ];

  it("lists where a lead can go", async () => {
    expect(await loadConvertTargets()).toEqual(expected);

    const res = await bulkRoute.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ targets: expected });
  });

  it("refuses someone without Sales access and reads nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await bulkRoute.GET();

    expect(res.status).toBe(403);
    expect(allCalls()).toEqual([]);
  });
});
