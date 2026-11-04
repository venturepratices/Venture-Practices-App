import { describe, expect, it, vi } from "vitest";

// The deal panel read model, run against a small fake database whose delegates
// record every call. The default `prisma` import is mocked only so loading the
// modules stays inert.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { loadDealPanel } = await import("@/lib/sales/deal-panel");
const { endOfDay } = await import("@/lib/utils");

type SalesActor = import("@/lib/sales/access").SalesActor;
type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "a", isAdmin: true, seesAllDeals: true, via: "user" };

const PIPELINE = { id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES" };
const STAGES = [
  {
    id: "s1",
    key: "lead-in",
    name: "Lead In",
    position: 1,
    probability: 10,
    isWon: false,
    isLost: false,
    requiresValue: false,
    isNoShow: false,
    rottingDays: 14,
  },
];

const deal = (extra: Row = {}) => ({
  id: "d1",
  title: "Oak Creek Dental",
  status: "OPEN",
  valueCents: 1_440_000,
  mrrCents: 120_000,
  stageId: "s1",
  stageEnteredAt: new Date("2026-11-01T15:00:00Z"),
  lostReason: null,
  lostComment: null,
  source: "Referral",
  ownerId: "r",
  owner: { id: "r", name: "Rachel P." },
  organization: { id: "o1", name: "Oak Creek Dental" },
  person: { id: "pe1", name: "Sarah K." },
  pipeline: PIPELINE,
  ...extra,
});

const field = (key: string, label: string, position: number, pipelineKeys: string[], extra: Row = {}) => ({
  id: `f-${key}`,
  key,
  label,
  entity: "DEAL",
  fieldType: "DATE",
  options: [],
  pipelineKeys,
  position,
  ...extra,
});
const FIELDS = [
  field("target-start-date", "Target Start Date", 1, []),
  field("territory-hold-expiry", "Territory Hold Expiry", 2, ["direct-mail", "new-mover-mail"]),
  field("engagement-type", "Engagement Type", 3, ["marketing-agency"], { fieldType: "SELECT", options: ["Start-up"] }),
  field("practice-zip", "Practice ZIP", 4, [], { entity: "LEAD", fieldType: "TEXT" }),
];

const holdCheck = {
  id: "act2",
  type: "DEADLINE",
  subject: "Territory hold check",
  dueAt: endOfDay("2026-11-12"),
  hasTime: false,
  createdBy: "rule:territory-hold",
  ownerId: "r",
};
const firstCall = {
  id: "act1",
  type: "CALL",
  subject: "First call",
  dueAt: endOfDay("2026-11-06"),
  hasTime: false,
  createdBy: "r",
  ownerId: "r",
};

function fakeDb(opts: { deal?: Row | null; values?: Row[]; activities?: Row[] } = {}) {
  return {
    salesDeal: { findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => (opts.deal === undefined ? deal() : opts.deal)) },
    salesStage: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => STAGES) },
    salesActivity: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.activities ?? [firstCall]) },
    // Honours the entity filter it is given, like the database would.
    salesCustomField: {
      findMany: vi.fn(async (args: Args) => FIELDS.filter((f) => args.where.entity === undefined || f.entity === args.where.entity)),
    },
    salesCustomFieldValue: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.values ?? []) },
    teamMember: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => [{ id: "r", name: "Rachel P." }, { id: "b", name: "Ben S." }]) },
  };
}

describe("loadDealPanel", () => {
  it("looks the deal up through the who-can-see filter", async () => {
    const db = fakeDb();
    await loadDealPanel(rep, "d1", db as never);

    expect(db.salesDeal.findFirst).toHaveBeenCalledTimes(1);
    expect(db.salesDeal.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", archivedAt: null, ownerId: "r" });
  });

  it("returns null for a deal that is archived, hidden or missing", async () => {
    const db = fakeDb({ deal: null });

    expect(await loadDealPanel(rep, "d1", db as never)).toBeNull();
    expect(db.salesActivity.findMany).not.toHaveBeenCalled();
  });

  it("returns null for a deal in a pipeline the board does not show", async () => {
    const db = fakeDb({ deal: deal({ pipeline: { ...PIPELINE, kind: "DELIVERY" } }) });

    expect(await loadDealPanel(admin, "d1", db as never)).toBeNull();
  });

  it("never selects a person's email or phone", async () => {
    const db = fakeDb();
    await loadDealPanel(rep, "d1", db as never);

    const select = JSON.stringify(db.salesDeal.findFirst.mock.calls[0][0].select);
    expect(select).not.toContain('"email"');
    expect(select).not.toContain('"phone"');
  });

  it("lets only the owner or an admin edit", async () => {
    expect((await loadDealPanel(seesAll, "d1", fakeDb({ deal: deal({ ownerId: "b" }) }) as never))?.canEdit).toBe(false);
    expect((await loadDealPanel(seesAll, "d1", fakeDb() as never))?.canEdit).toBe(true);
    expect((await loadDealPanel(admin, "d1", fakeDb({ deal: deal({ ownerId: "b" }) }) as never))?.canEdit).toBe(true);
  });

  it("gives the deal, its pipeline, stages, open activities and the team", async () => {
    const db = fakeDb();
    const panel = await loadDealPanel(rep, "d1", db as never);

    expect(panel?.deal).toEqual({
      id: "d1",
      title: "Oak Creek Dental",
      status: "OPEN",
      valueCents: 1_440_000,
      mrrCents: 120_000,
      stageId: "s1",
      stageEnteredAt: "2026-11-01T15:00:00.000Z",
      lostReason: null,
      lostComment: null,
      source: "Referral",
      owner: { id: "r", name: "Rachel P." },
      organization: { id: "o1", name: "Oak Creek Dental" },
      person: { id: "pe1", name: "Sarah K." },
    });
    expect(panel?.pipeline).toEqual(PIPELINE);
    expect(panel?.stages).toEqual(STAGES);
    expect(db.salesStage.findMany.mock.calls[0][0]).toMatchObject({
      where: { pipelineId: "p1", archivedAt: null },
      orderBy: { position: "asc" },
    });
    expect(panel?.openActivities).toEqual([{ ...firstCall, dueAt: endOfDay("2026-11-06").toISOString() }]);
    expect(db.salesActivity.findMany.mock.calls[0][0].where).toEqual({ dealId: "d1", doneAt: null, archivedAt: null });
    expect(panel?.members).toEqual([
      { id: "r", name: "Rachel P." },
      { id: "b", name: "Ben S." },
    ]);
  });

  it("shows the deal fields for its pipeline, in order, with stored values", async () => {
    const db = fakeDb({ values: [{ fieldId: "f-territory-hold-expiry", value: "2026-11-19" }] });
    const panel = await loadDealPanel(rep, "d1", db as never);

    expect(db.salesCustomFieldValue.findMany.mock.calls[0][0].where).toEqual({ dealId: "d1" });
    expect(panel?.fields).toEqual([
      { key: "target-start-date", label: "Target Start Date", fieldType: "DATE", options: [], value: null },
      { key: "territory-hold-expiry", label: "Territory Hold Expiry", fieldType: "DATE", options: [], value: "2026-11-19" },
    ]);
  });

  it("shows the territory hold with its open check", async () => {
    const db = fakeDb({
      values: [{ fieldId: "f-territory-hold-expiry", value: "2026-11-19" }],
      activities: [firstCall, holdCheck],
    });
    const panel = await loadDealPanel(rep, "d1", db as never);

    expect(panel?.territoryHold).toEqual({ expiry: "2026-11-19", checkDueAt: endOfDay("2026-11-12").toISOString() });
  });

  it("shows a hold without a check when the check is gone", async () => {
    const panel = await loadDealPanel(
      rep,
      "d1",
      fakeDb({ values: [{ fieldId: "f-territory-hold-expiry", value: "2026-11-19" }] }) as never,
    );

    expect(panel?.territoryHold).toEqual({ expiry: "2026-11-19", checkDueAt: null });
  });

  it("shows no hold when the expiry is empty", async () => {
    const panel = await loadDealPanel(rep, "d1", fakeDb({ activities: [holdCheck] }) as never);

    expect(panel?.territoryHold).toBeNull();
  });
});
