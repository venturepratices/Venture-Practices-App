import { describe, expect, it, vi } from "vitest";

// The Sales dashboard read model: the app-time month bounds, the KPI tiles, the
// four boxes (Today and overdue, No next step, Deals in Follow-Up, Recent
// activity) and the "Expected to close" forecast, run against a small fake
// database whose delegates record every call. The default `prisma` import is
// mocked only so loading the modules stays inert.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { appMonthBounds, loadDashboard, parseDashboardScope, weightedCents } = await import("@/lib/sales/dashboard");
const { endOfDay, startOfDay } = await import("@/lib/utils");

type SalesActor = import("@/lib/sales/access").SalesActor;
type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };

const now = new Date("2026-11-05T15:00:00Z");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };

const MEMBERS = [
  { id: "b", name: "Ben S." },
  { id: "r", name: "Rachel P." },
];

const KINDS = { kind: { in: ["SALES", "CONSULTING"] } };
/** The open deals the dashboard reads for a person: Sales and Consulting pipelines, plus the who-can-see owner. */
const scopeOf = (owner: Row) => ({ archivedAt: null, status: "OPEN", pipeline: { ...KINDS, archivedAt: null }, ...owner });
const R_SCOPE = scopeOf({ ownerId: "r" });

const OPEN_ACTIVITY = { doneAt: null, archivedAt: null };
/** The deal-or-lead half of an activity filter for work to do (activities-page.ts), written out by hand. */
const toDoParents = (owner: Row) => ({
  OR: [
    { dealId: { not: null }, deal: { archivedAt: null, status: "OPEN", ...owner } },
    { dealId: null, leadId: { not: null }, lead: { archivedAt: null, status: "OPEN", ...owner } },
  ],
});

type Stage = { id: string; key: string; probability: number; isLost: boolean; archivedAt: Date | null; pipeline: { key: string; position: number } };

const STAGES: Stage[] = [
  { id: "s4", key: "proposal-sent", probability: 30, isLost: false, archivedAt: null, pipeline: { key: "direct-mail", position: 1 } },
  { id: "s9", key: "closed-lost", probability: 100, isLost: true, archivedAt: null, pipeline: { key: "direct-mail", position: 1 } },
  { id: "s5", key: "demo", probability: 50, isLost: false, archivedAt: null, pipeline: { key: "direct-mail", position: 1 } },
];

const auditRow = (id: string, minutesAgo: number, dealId: string, extra: Row = {}): Row => ({
  id,
  at: new Date(Date.UTC(2026, 10, 5, 14, 0, 0) - minutesAgo * 60_000),
  entityType: "SalesDeal",
  entityId: dealId,
  actorType: "USER",
  actorId: "b",
  action: "stage_changed",
  before: { stageId: "s1", stageName: "Lead In" },
  after: { stageId: "s4", stageName: "Proposal Sent" },
  ...extra,
});

/** A full page (50 rows) of history, `visible` rows of it on deal "d1" (first), the rest on a deal the person cannot see. */
const auditPage = (page: number, visible: number, size = 50): Row[] =>
  Array.from({ length: size }, (_, i) => auditRow(`h${page}-${i}`, page * 1000 + i, i < visible ? "d1" : "dx"));

type State = {
  open: Row;
  won: Row;
  overdue: number;
  todayCount: number;
  today: Row[];
  stalledDeals: Row[];
  stalledDealCount: number;
  stalledLeads: Row[];
  stalledLeadCount: number;
  followUp: Row[];
  stages: Stage[];
  thisMonth: Row[];
  nextMonth: Row[];
  noCloseDate: number;
  auditPages: Row[][];
  recentDeals: Row[];
  viewer: Row | null;
};

function fakeDb(patch: Partial<State> = {}) {
  const state: State = {
    open: { _count: { _all: 0 }, _sum: { valueCents: null } },
    won: { _count: { _all: 0 }, _sum: { valueCents: null } },
    overdue: 0,
    todayCount: 0,
    today: [],
    stalledDeals: [],
    stalledDealCount: 0,
    stalledLeads: [],
    stalledLeadCount: 0,
    followUp: [],
    stages: STAGES,
    thisMonth: [],
    nextMonth: [],
    noCloseDate: 0,
    auditPages: [],
    recentDeals: [],
    viewer: { name: "Rachel P." },
    ...patch,
  };
  let auditCall = 0;
  const thisMonthStart = startOfDay("2026-11-01").getTime();
  return {
    salesDeal: {
      aggregate: vi.fn(async (args: Args) => (args.where.status === "WON" ? state.won : state.open)),
      count: vi.fn(async (args: Args) => (args.where.expectedCloseDate === null ? state.noCloseDate : state.stalledDealCount)),
      groupBy: vi.fn(async (args: Args) =>
        ((args.where.expectedCloseDate as { gte: Date }).gte.getTime() === thisMonthStart ? state.thisMonth : state.nextMonth),
      ),
      findMany: vi.fn(async (args: Args) => {
        const ids = (args.where.id as { in?: string[] } | undefined)?.in;
        if (ids) {
          return state.recentDeals.filter(
            (deal) => ids.includes(deal.id as string) && (args.where.ownerId === undefined || deal.ownerId === args.where.ownerId),
          );
        }
        if (args.where.stage) return state.followUp;
        return state.stalledDeals;
      }),
    },
    salesLead: {
      findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.stalledLeads),
      count: vi.fn<(args: Args) => Promise<unknown>>(async () => state.stalledLeadCount),
    },
    salesActivity: {
      findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.today),
      count: vi.fn(async (args: Args) => ("lt" in (args.where.dueAt as Row) ? state.overdue : state.todayCount)),
    },
    salesStage: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.stages) },
    salesAuditLog: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.auditPages[auditCall++] ?? []) },
    teamMember: {
      findUnique: vi.fn<(args: Args) => Promise<unknown>>(async () => state.viewer),
      findMany: vi.fn(async (args: Args) => {
        const ids = (args.where.id as { in?: string[] } | undefined)?.in;
        return ids ? MEMBERS.filter((member) => ids.includes(member.id)) : MEMBERS;
      }),
    },
  };
}

type Db = ReturnType<typeof fakeDb>;
const load = (db: Db, actor: SalesActor = rep, scope: "everyone" | "mine" = "everyone", at: Date = now) =>
  loadDashboard(actor, scope, at, db as never);

/** The `where` of the aggregate call for one status. */
const aggregateWhere = (db: Db, status: string) =>
  db.salesDeal.aggregate.mock.calls.map(([args]) => args).find((args) => args.where.status === status);

describe("appMonthBounds", () => {
  it("reads the Eastern month", () => {
    expect(appMonthBounds(now)).toEqual({
      thisMonth: startOfDay("2026-11-01"),
      nextMonth: startOfDay("2026-12-01"),
      monthAfter: startOfDay("2027-01-01"),
    });
  });

  it("won this month and the forecast read the Eastern month on Nov 30 at 11:30 PM", () => {
    // 04:30 UTC on Dec 1 is 11:30 PM Eastern on Nov 30: still November for the team.
    expect(appMonthBounds(new Date("2026-12-01T04:30:00Z"))).toEqual({
      thisMonth: startOfDay("2026-11-01"),
      nextMonth: startOfDay("2026-12-01"),
      monthAfter: startOfDay("2027-01-01"),
    });
    // November ends at midnight Eastern, so a deal won at 04:30Z on Dec 1 counts in November...
    expect(startOfDay("2026-12-01").toISOString()).toBe("2026-12-01T05:00:00.000Z");
    expect(new Date("2026-12-01T04:30:00Z").getTime()).toBeLessThan(startOfDay("2026-12-01").getTime());
    // ...and an expected close of Nov 30 (stored as its Eastern end of day) is this month, not next.
    expect(endOfDay("2026-11-30").getTime()).toBeLessThan(startOfDay("2026-12-01").getTime());
  });
});

describe("parseDashboardScope", () => {
  it("reads the scope and the viewer's name", async () => {
    expect(parseDashboardScope({ scope: "mine" })).toBe("mine");
    expect(parseDashboardScope({ scope: ["mine", "everyone"] })).toBe("mine");
    expect(parseDashboardScope({})).toBe("everyone");
    expect(parseDashboardScope({ scope: "all" })).toBe("everyone");

    const db = fakeDb();
    const data = await load(db);
    expect(db.teamMember.findUnique.mock.calls).toEqual([[{ where: { id: "r" }, select: { name: true } }]]);
    expect(data.viewerName).toBe("Rachel P.");
    expect(data.scope).toBe("everyone");
    expect(data.canSeeEveryone).toBe(false);
    expect(data.members).toEqual(MEMBERS);

    expect((await load(fakeDb({ viewer: null }), admin)).viewerName).toBe("");
    expect((await load(fakeDb(), admin, "mine")).canSeeEveryone).toBe(true);
  });
});

describe("loadDashboard", () => {
  it("KPI tiles follow Everyone / Just me over Sales and Consulting", async () => {
    const db = fakeDb({
      open: { _count: { _all: 3 }, _sum: { valueCents: 4_320_000 } },
      won: { _count: { _all: 2 }, _sum: { valueCents: 2_880_000 } },
      overdue: 4,
    });
    const data = await load(db);

    expect(aggregateWhere(db, "OPEN")).toEqual({ where: R_SCOPE, _count: { _all: true }, _sum: { valueCents: true } });
    expect(aggregateWhere(db, "WON")).toEqual({
      where: {
        archivedAt: null,
        status: "WON",
        wonAt: { gte: startOfDay("2026-11-01"), lt: startOfDay("2026-12-01") },
        pipeline: { ...KINDS, archivedAt: null },
        ownerId: "r",
      },
      _count: { _all: true },
      _sum: { valueCents: true },
    });
    const overdueWhere = db.salesActivity.count.mock.calls.map(([args]) => args.where).find((where) => "lt" in (where.dueAt as Row));
    expect(overdueWhere).toEqual({ ...OPEN_ACTIVITY, dueAt: { lt: startOfDay("2026-11-05") }, ...toDoParents({ ownerId: "r" }) });
    expect(data.kpis).toEqual({
      openDeals: 3,
      pipelineCents: 4_320_000,
      wonThisMonthCents: 2_880_000,
      wonThisMonthCount: 2,
      overdueActivities: 4,
    });

    // Nothing won and nothing open: zeros, not nulls.
    expect((await load(fakeDb())).kpis).toEqual({
      openDeals: 0,
      pipelineCents: 0,
      wonThisMonthCents: 0,
      wonThisMonthCount: 0,
      overdueActivities: 0,
    });

    // Just me: the person's own deals, and only the activities they own.
    const mine = fakeDb();
    await load(mine, rep, "mine");
    expect(aggregateWhere(mine, "OPEN")?.where).toEqual(R_SCOPE);
    const mineOverdue = mine.salesActivity.count.mock.calls.map(([args]) => args.where).find((where) => "lt" in (where.dueAt as Row));
    expect(mineOverdue).toEqual({
      ...OPEN_ACTIVITY,
      dueAt: { lt: startOfDay("2026-11-05") },
      ownerId: "r",
      ...toDoParents({ ownerId: "r" }),
    });

    // An admin on Everyone has no owner in the deal scope; on Just me, their own.
    const everyone = fakeDb();
    await load(everyone, admin);
    expect(aggregateWhere(everyone, "OPEN")?.where).toEqual(scopeOf({}));
    expect(aggregateWhere(everyone, "WON")?.where).not.toHaveProperty("ownerId");
    const adminMine = fakeDb();
    await load(adminMine, admin, "mine");
    expect(aggregateWhere(adminMine, "OPEN")?.where).toEqual(scopeOf({ ownerId: "b" }));
    expect(aggregateWhere(adminMine, "WON")?.where).toMatchObject({ ownerId: "b" });
  });

  it("lists today's and overdue work on deals and leads, most overdue first", async () => {
    const dueCall = endOfDay("2026-11-03");
    const db = fakeDb({
      todayCount: 11,
      today: [
        {
          id: "a1",
          type: "CALL",
          subject: "Follow-up call",
          dueAt: dueCall,
          hasTime: false,
          ownerId: "r",
          deal: { id: "d1", title: "Oak Creek Dental" },
          lead: { id: "l9", title: "Oak Creek Dental" },
        },
        {
          id: "a2",
          type: "MEETING",
          subject: "Intro",
          dueAt: new Date("2026-11-05T18:00:00Z"),
          hasTime: true,
          ownerId: "r",
          deal: null,
          lead: { id: "l1", title: "Crestview Dental" },
        },
      ],
    });
    const data = await load(db);

    const [listArgs] = db.salesActivity.findMany.mock.calls[0];
    expect(listArgs).toMatchObject({
      where: { ...OPEN_ACTIVITY, dueAt: { lte: endOfDay("2026-11-05") }, ...toDoParents({ ownerId: "r" }) },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 8,
    });
    expect(listArgs.where).toEqual({ ...OPEN_ACTIVITY, dueAt: { lte: endOfDay("2026-11-05") }, ...toDoParents({ ownerId: "r" }) });
    const todayWhere = db.salesActivity.count.mock.calls.map(([args]) => args.where).find((where) => "lte" in (where.dueAt as Row));
    expect(todayWhere).toEqual(listArgs.where);

    // A converted lead's call that moved to the deal is the deal's.
    expect(data.today).toEqual([
      {
        id: "a1",
        type: "CALL",
        subject: "Follow-up call",
        dueAt: dueCall.toISOString(),
        hasTime: false,
        ownerId: "r",
        parent: { kind: "deal", id: "d1", title: "Oak Creek Dental" },
      },
      {
        id: "a2",
        type: "MEETING",
        subject: "Intro",
        dueAt: "2026-11-05T18:00:00.000Z",
        hasTime: true,
        ownerId: "r",
        parent: { kind: "lead", id: "l1", title: "Crestview Dental" },
      },
    ]);
    expect(data.todayCount).toBe(11);

    // Just me: only the activities the person owns.
    const mine = fakeDb();
    await load(mine, rep, "mine");
    expect(mine.salesActivity.findMany.mock.calls[0][0].where).toEqual({
      ...OPEN_ACTIVITY,
      dueAt: { lte: endOfDay("2026-11-05") },
      ownerId: "r",
      ...toDoParents({ ownerId: "r" }),
    });
  });

  it("finds deals and leads with no next step", async () => {
    const day = (n: number) => new Date(Date.UTC(2026, 9, n, 15));
    const db = fakeDb({
      stalledDealCount: 12,
      stalledLeadCount: 4,
      stalledDeals: [1, 3, 5, 7, 9, 11, 13, 15].map((n) => ({
        id: `d${n}`,
        title: `Deal ${n}`,
        stageEnteredAt: day(n),
        ownerId: "r",
        stage: { name: "Demo" },
      })),
      stalledLeads: [2, 4, 6].map((n) => ({ id: `l${n}`, title: `Lead ${n}`, createdAt: day(n), ownerId: "r" })),
    });
    const data = await load(db);

    const [dealArgs] = db.salesDeal.findMany.mock.calls.find(([args]) => "activities" in args.where) ?? [];
    expect(dealArgs).toMatchObject({
      where: { ...R_SCOPE, activities: { none: OPEN_ACTIVITY } },
      orderBy: [{ stageEnteredAt: "asc" }, { id: "asc" }],
      take: 8,
    });
    expect(dealArgs?.where).toEqual({ ...R_SCOPE, activities: { none: OPEN_ACTIVITY } });
    const [leadArgs] = db.salesLead.findMany.mock.calls[0];
    expect(leadArgs).toMatchObject({
      where: { status: "OPEN", archivedAt: null, ownerId: "r", activities: { none: OPEN_ACTIVITY } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 8,
    });
    expect(leadArgs.where).toEqual({ status: "OPEN", archivedAt: null, ownerId: "r", activities: { none: OPEN_ACTIVITY } });
    expect(db.salesDeal.count.mock.calls.map(([args]) => args.where)).toContainEqual(dealArgs?.where);
    expect(db.salesLead.count.mock.calls).toEqual([[{ where: leadArgs.where }]]);

    // Oldest first across both lists, 8 at most.
    expect(data.noNextStep.map((row) => row.id)).toEqual(["d1", "l2", "d3", "l4", "d5", "l6", "d7", "d9"]);
    expect(data.noNextStep[0]).toEqual({
      kind: "deal",
      id: "d1",
      title: "Deal 1",
      since: day(1).toISOString(),
      stageName: "Demo",
      ownerId: "r",
    });
    expect(data.noNextStep[1]).toEqual({ kind: "lead", id: "l2", title: "Lead 2", since: day(2).toISOString(), stageName: null, ownerId: "r" });
    expect(data.noNextStepCount).toBe(16);

    // An admin on Everyone: no owner on either list.
    const everyone = fakeDb();
    await load(everyone, admin);
    expect(everyone.salesLead.findMany.mock.calls[0][0].where).toEqual({
      status: "OPEN",
      archivedAt: null,
      activities: { none: OPEN_ACTIVITY },
    });
  });

  it("shows deals in Follow-Up", async () => {
    const db = fakeDb({
      followUp: [
        {
          id: "d4",
          title: "Lakeside Ortho",
          valueCents: 1_440_000,
          mrrCents: 120_000,
          ownerId: "r",
          pipeline: { name: "Direct Mail" },
          activities: [{ type: "CALL", subject: "Check in", dueAt: endOfDay("2026-11-09"), hasTime: false }],
        },
        {
          id: "d2",
          title: "Bright Smiles Dental",
          valueCents: 0,
          mrrCents: 0,
          ownerId: "r",
          pipeline: { name: "Direct Mail" },
          activities: [],
        },
      ],
    });
    const data = await load(db);

    const [args] = db.salesDeal.findMany.mock.calls.find(([call]) => "stage" in call.where) ?? [];
    expect(args).toMatchObject({
      where: { ...R_SCOPE, stage: { key: "follow-up" } },
      orderBy: [{ stageEnteredAt: "desc" }, { id: "desc" }],
      take: 8,
    });
    expect(args?.where).toEqual({ ...R_SCOPE, stage: { key: "follow-up" } });
    // The earliest open activity is the deal's next step.
    expect(args?.select).toMatchObject({
      activities: { where: OPEN_ACTIVITY, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 1 },
    });
    expect(data.followUp).toEqual([
      {
        id: "d4",
        title: "Lakeside Ortho",
        pipelineName: "Direct Mail",
        valueCents: 1_440_000,
        mrrCents: 120_000,
        ownerId: "r",
        next: { type: "CALL", subject: "Check in", dueAt: endOfDay("2026-11-09").toISOString(), hasTime: false },
      },
      { id: "d2", title: "Bright Smiles Dental", pipelineName: "Direct Mail", valueCents: 0, mrrCents: 0, ownerId: "r", next: null },
    ]);
  });

  it("links Follow-Up to a pipeline that has it", async () => {
    const followUp = (id: string, pipelineKey: string, position: number, archivedAt: Date | null = null): Stage => ({
      id,
      key: "follow-up",
      probability: 40,
      isLost: false,
      archivedAt,
      pipeline: { key: pipelineKey, position },
    });
    // Listed out of order on purpose: the pipeline with the lowest position wins.
    const both = fakeDb({ stages: [...STAGES, followUp("f2", "new-mover-mail", 2), followUp("f1", "direct-mail", 1)] });
    expect((await load(both)).followUpPipelineKey).toBe("direct-mail");

    const archived = fakeDb({ stages: [followUp("f1", "direct-mail", 1, now), followUp("f2", "new-mover-mail", 2)] });
    expect((await load(archived)).followUpPipelineKey).toBe("new-mover-mail");

    expect((await load(fakeDb())).followUpPipelineKey).toBeNull();

    // One stage read over the Sales and Consulting pipelines gives both the win chances and the link.
    const db = fakeDb();
    await load(db);
    expect(db.salesStage.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesStage.findMany.mock.calls[0][0].where).toEqual({ pipeline: { ...KINDS, archivedAt: null } });
  });

  it("weights the forecast by win chance; lost stages count nothing", async () => {
    const stages = new Map([
      ["s4", { probability: 30, isLost: false }],
      ["s9", { probability: 100, isLost: true }],
      ["s5", { probability: 50, isLost: false }],
    ]);
    expect(
      weightedCents(
        [
          { stageId: "s4", sumCents: 1_000_000 },
          { stageId: "s9", sumCents: 500_000 },
          { stageId: "s5", sumCents: 100_001 },
        ],
        stages,
      ),
    ).toBe(350_001);
    // A stage the read did not find counts nothing.
    expect(weightedCents([{ stageId: "gone", sumCents: 900_000 }], stages)).toBe(0);
    expect(weightedCents([], stages)).toBe(0);

    const db = fakeDb({
      thisMonth: [
        { stageId: "s4", _sum: { valueCents: 1_000_000 } },
        { stageId: "s9", _sum: { valueCents: 500_000 } },
      ],
      nextMonth: [
        { stageId: "s5", _sum: { valueCents: 100_001 } },
        { stageId: "s4", _sum: { valueCents: null } },
      ],
      noCloseDate: 6,
    });
    const data = await load(db);

    expect(db.salesDeal.groupBy.mock.calls).toEqual([
      [
        {
          by: ["stageId"],
          where: { ...R_SCOPE, expectedCloseDate: { gte: startOfDay("2026-11-01"), lt: startOfDay("2026-12-01") } },
          _sum: { valueCents: true },
        },
      ],
      [
        {
          by: ["stageId"],
          where: { ...R_SCOPE, expectedCloseDate: { gte: startOfDay("2026-12-01"), lt: startOfDay("2027-01-01") } },
          _sum: { valueCents: true },
        },
      ],
    ]);
    expect(db.salesDeal.count.mock.calls.map(([args]) => args.where)).toContainEqual({ ...R_SCOPE, expectedCloseDate: null });
    expect(data.forecast).toEqual({ thisMonthCents: 300_000, nextMonthCents: 50_001, noCloseDateCount: 6 });
  });

  it("recent activity keeps only deals the viewer may see", async () => {
    const db = fakeDb({
      auditPages: [auditPage(1, 9)],
      recentDeals: [
        { id: "d1", title: "Oak Creek Dental", ownerId: "r" },
        { id: "dx", title: "Lakeside Ortho", ownerId: "b" },
      ],
    });
    const data = await load(db);

    expect(db.salesAuditLog.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesAuditLog.findMany.mock.calls[0][0]).toMatchObject({
      where: { entityType: "SalesDeal" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: 50,
    });
    expect(db.salesAuditLog.findMany.mock.calls[0][0].where).toEqual({ entityType: "SalesDeal" });
    const lookups = db.salesDeal.findMany.mock.calls.filter(([args]) => args.where.id !== undefined);
    expect(lookups).toHaveLength(1);
    expect(lookups[0][0].where).toEqual({ id: { in: ["d1", "dx"] }, archivedAt: null, ownerId: "r" });

    // The newest 7 of the 9 visible rows, each worded by the History rules.
    expect(data.recent.map((row) => row.id)).toEqual(["h1-0", "h1-1", "h1-2", "h1-3", "h1-4", "h1-5", "h1-6"]);
    expect(data.recent[0]).toEqual({
      id: "h1-0",
      at: new Date(Date.UTC(2026, 10, 5, 14, 0, 0) - 1000 * 60_000).toISOString(),
      icon: "stage",
      text: "Moved to Proposal Sent",
      dealId: "d1",
      dealTitle: "Oak Creek Dental",
      actorName: "Ben S.",
    });
  });

  it("recent activity reads the next page after the last row when a page finds fewer than 7", async () => {
    const page1 = auditPage(1, 2);
    const db = fakeDb({
      auditPages: [page1, auditPage(2, 5), auditPage(3, 50)],
      recentDeals: [{ id: "d1", title: "Oak Creek Dental", ownerId: "r" }],
    });
    const data = await load(db);

    expect(db.salesAuditLog.findMany).toHaveBeenCalledTimes(2);
    const last = page1[49];
    expect(db.salesAuditLog.findMany.mock.calls[1][0].where).toEqual({
      entityType: "SalesDeal",
      OR: [{ at: { lt: last.at } }, { at: last.at, id: { lt: last.id } }],
    });
    expect(data.recent.map((row) => row.id)).toEqual(["h1-0", "h1-1", "h2-0", "h2-1", "h2-2", "h2-3", "h2-4"]);
  });

  it("recent activity reads at most 4 pages and stops at a short page", async () => {
    const full = fakeDb({
      auditPages: [auditPage(1, 1), auditPage(2, 1), auditPage(3, 1), auditPage(4, 0), auditPage(5, 50)],
      recentDeals: [{ id: "d1", title: "Oak Creek Dental", ownerId: "r" }],
    });
    const data = await load(full);
    expect(full.salesAuditLog.findMany).toHaveBeenCalledTimes(4);
    expect(data.recent.map((row) => row.id)).toEqual(["h1-0", "h2-0", "h3-0"]);

    // A page shorter than 50 is the end of the history: no further read.
    const short = fakeDb({ auditPages: [auditPage(1, 1, 20), auditPage(2, 50)], recentDeals: [{ id: "d1", title: "Oak", ownerId: "r" }] });
    expect((await load(short)).recent).toHaveLength(1);
    expect(short.salesAuditLog.findMany).toHaveBeenCalledTimes(1);

    // No history at all: no deal lookup and no name lookup.
    const empty = fakeDb();
    expect((await load(empty)).recent).toEqual([]);
    expect(empty.salesDeal.findMany.mock.calls.filter(([args]) => args.where.id !== undefined)).toEqual([]);
    expect(empty.teamMember.findMany.mock.calls.filter(([args]) => args.where.id !== undefined)).toEqual([]);
  });

  it("recent activity names people from one lookup, including a new owner", async () => {
    const db = fakeDb({
      auditPages: [
        [
          auditRow("h1", 1, "d1", { action: "owner_changed", before: { ownerId: "r" }, after: { ownerId: "b" }, actorId: "r" }),
          auditRow("h2", 2, "d1", { actorType: "SYSTEM", actorId: null, after: { stageId: "s3", stageName: "No Show" } }),
          auditRow("h3", 3, "d1", { actorId: "gone" }),
        ],
      ],
      recentDeals: [{ id: "d1", title: "Oak Creek Dental", ownerId: "r" }],
    });
    const data = await load(db);

    const nameLookups = db.teamMember.findMany.mock.calls.filter(([args]) => args.where.id !== undefined);
    expect(nameLookups).toHaveLength(1);
    expect(new Set((nameLookups[0][0].where.id as { in: string[] }).in)).toEqual(new Set(["r", "b", "gone"]));
    expect(data.recent.map(({ text, actorName, icon }) => ({ text, actorName, icon }))).toEqual([
      { text: "Owner changed to Ben S.", actorName: "Rachel P.", icon: "owner" },
      { text: "Moved to No Show (No Show rule)", actorName: null, icon: "stage" },
      { text: "Moved to Proposal Sent", actorName: null, icon: "stage" },
    ]);
  });

  it("starts every query at once and never selects a person's email or phone", async () => {
    let release: (value: Row) => void = () => {};
    const db = fakeDb();
    db.teamMember.findUnique.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const pending = load(db);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The viewer's name is still loading; every other first read has already started.
    expect(db.salesDeal.aggregate).toHaveBeenCalledTimes(2);
    expect(db.salesDeal.groupBy).toHaveBeenCalledTimes(2);
    expect(db.salesActivity.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesActivity.count).toHaveBeenCalledTimes(2);
    expect(db.salesLead.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesStage.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesAuditLog.findMany).toHaveBeenCalledTimes(1);
    release({ name: "Rachel P." });
    await pending;

    const selects = JSON.stringify([
      ...db.salesDeal.findMany.mock.calls.map(([args]) => args.select),
      ...db.salesLead.findMany.mock.calls.map(([args]) => args.select),
      ...db.salesActivity.findMany.mock.calls.map(([args]) => args.select),
    ]);
    expect(selects).not.toContain('"email"');
    expect(selects).not.toContain('"phone"');
  });
});
