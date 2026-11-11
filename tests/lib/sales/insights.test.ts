import { describe, expect, it, vi } from "vitest";

// The Insights page: its URL (client-safe parser and serializer), the app-time
// months it covers, and the four charts' data (pipeline funnel, deals won over
// time, average deal cycle time, activities completed per person), run against
// a small fake database whose delegates record every call. The default `prisma`
// import is mocked only so loading the modules stays inert.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { insightsQueryToSearch, parseInsightsQuery } = await import("@/lib/sales/insights-query");
const { insightMonths, loadInsights } = await import("@/lib/sales/insights");
const { startOfDay, zonedDateTime } = await import("@/lib/utils");

type SalesActor = import("@/lib/sales/access").SalesActor;
type InsightsQuery = import("@/lib/sales/insights-query").InsightsQuery;
type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };

const now = new Date("2026-11-05T15:00:00Z");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };

const MEMBERS = [
  { id: "b", name: "Ben S." },
  { id: "r", name: "Rachel P." },
];

const PIPELINES = [
  { id: "pm1", key: "direct-mail", name: "Direct Mail", kind: "SALES" },
  { id: "pm2", key: "new-mover-mail", name: "New Mover Mail", kind: "SALES" },
];

const stage = (id: string, name: string, position: number, extra: Row = {}) => ({
  id,
  key: name.toLowerCase().replace(/ /g, "-"),
  name,
  position,
  probability: 10 * position,
  isWon: false,
  isLost: false,
  requiresValue: false,
  isNoShow: false,
  rottingDays: 14,
  ...extra,
});
const STAGES: Record<string, Row[]> = {
  pm1: [stage("s1", "New Opt-In", 1), stage("s2", "Demo", 2), stage("s3", "Proposal Sent", 3), stage("s4", "Contract Signed", 4, { isWon: true })],
  pm2: [stage("t1", "Mailed", 1)],
};

const query = (patch: Partial<InsightsQuery> = {}): InsightsQuery => ({ range: 3, scope: "everyone", pipeline: null, ...patch });

/** The deal-or-lead half of an activity filter for done work (activities-page.ts), written out by hand. */
const doneParents = (owner: Row) => ({
  OR: [
    { dealId: { not: null }, deal: { archivedAt: null, ...owner } },
    { dealId: null, leadId: { not: null }, lead: { archivedAt: null, ...owner } },
  ],
});

type State = { pipelines: Row[]; funnel: Row[]; won: Row[]; done: Row[] };

function fakeDb(patch: Partial<State> = {}) {
  const state: State = { pipelines: PIPELINES, funnel: [], won: [], done: [], ...patch };
  return {
    salesPipeline: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.pipelines) },
    salesStage: { findMany: vi.fn(async (args: Args) => STAGES[args.where.pipelineId as string] ?? []) },
    salesDeal: {
      groupBy: vi.fn<(args: Args) => Promise<unknown>>(async () => state.funnel),
      findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.won),
    },
    salesActivity: { groupBy: vi.fn<(args: Args) => Promise<unknown>>(async () => state.done) },
    teamMember: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => MEMBERS) },
  };
}

type Db = ReturnType<typeof fakeDb>;
const load = (db: Db, q: InsightsQuery = query(), actor: SalesActor = rep, at: Date = now) => loadInsights(actor, q, at, db as never);

const won = (wonAt: Date, valueCents: number, createdAt: Date = new Date("2026-08-01T15:00:00Z")) => ({ wonAt, createdAt, valueCents });

describe("parseInsightsQuery and insightsQueryToSearch", () => {
  it("parses the Insights URL", () => {
    expect(parseInsightsQuery({})).toEqual({ range: 3, scope: "everyone", pipeline: null });
    expect(parseInsightsQuery({ range: "6" }).range).toBe(6);
    expect(parseInsightsQuery({ range: "12" }).range).toBe(12);
    expect(parseInsightsQuery({ range: "7" }).range).toBe(3);
    expect(parseInsightsQuery({ range: ["12", "6"], scope: "mine", pipeline: "direct-mail" })).toEqual({
      range: 12,
      scope: "mine",
      pipeline: "direct-mail",
    });
    expect(parseInsightsQuery({ scope: "theirs", pipeline: "" })).toEqual({ range: 3, scope: "everyone", pipeline: null });
    expect(parseInsightsQuery({ pipeline: "x".repeat(65) }).pipeline).toBeNull();

    expect(insightsQueryToSearch({ range: 12, scope: "mine", pipeline: "direct-mail" })).toBe("range=12&scope=mine&pipeline=direct-mail");
    expect(insightsQueryToSearch({ range: 3, scope: "everyone", pipeline: null })).toBe("");
    expect(insightsQueryToSearch({ range: 6, scope: "everyone", pipeline: null })).toBe("range=6");
  });
});

describe("insightMonths", () => {
  it("counts months in Eastern time", () => {
    expect(insightMonths(now, 3)).toEqual(["2026-09", "2026-10", "2026-11"]);
    const year = insightMonths(now, 12);
    expect(year).toHaveLength(12);
    expect(year[0]).toBe("2025-12");
    expect(year[11]).toBe("2026-11");
    expect(year).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    // 04:30 UTC on Dec 1 is 11:30 PM Eastern on Nov 30: November is still this month.
    expect(insightMonths(new Date("2026-12-01T04:30:00Z"), 3)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
});

describe("loadInsights", () => {
  it("reads won deals once, and says when it hit the cap", async () => {
    const db = fakeDb({ won: [won(new Date("2026-10-12T15:00:00Z"), 1_440_000)] });
    const data = await load(db);

    expect(db.salesDeal.findMany.mock.calls).toEqual([
      [
        {
          where: {
            archivedAt: null,
            status: "WON",
            wonAt: { gte: startOfDay("2026-09-01") },
            pipeline: { kind: { in: ["SALES", "CONSULTING"] } },
            ownerId: "r",
          },
          select: { wonAt: true, createdAt: true, valueCents: true },
          orderBy: { wonAt: "asc" },
          take: 5000,
        },
      ],
    ]);
    expect(data.capped).toBe(false);
    expect(data.months).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(data.wonByMonth).toEqual([
      { month: "2026-09", valueCents: 0, count: 0 },
      { month: "2026-10", valueCents: 1_440_000, count: 1 },
      { month: "2026-11", valueCents: 0, count: 0 },
    ]);

    const capped = fakeDb({ won: Array.from({ length: 5000 }, () => won(new Date("2026-10-12T15:00:00Z"), 100)) });
    expect((await load(capped)).capped).toBe(true);

    // An admin on Everyone reads every rep's won deals; Just me, their own; 12 months start 11 months back.
    const everyone = fakeDb();
    await load(everyone, query({ range: 12 }), admin);
    expect(everyone.salesDeal.findMany.mock.calls[0][0].where).toEqual({
      archivedAt: null,
      status: "WON",
      wonAt: { gte: startOfDay("2025-12-01") },
      pipeline: { kind: { in: ["SALES", "CONSULTING"] } },
    });
    const mine = fakeDb();
    await load(mine, query({ scope: "mine" }), admin);
    expect(mine.salesDeal.findMany.mock.calls[0][0].where).toMatchObject({ ownerId: "b" });
  });

  it("buckets a deal won at 11:30 PM Eastern on Oct 31 in October", async () => {
    const data = await load(
      fakeDb({
        won: [
          // 03:30 UTC on Nov 1 is 11:30 PM Eastern (EDT) on Oct 31.
          won(new Date("2026-11-01T03:30:00Z"), 500_000),
          // An hour later it is 12:30 AM Eastern on Nov 1.
          won(new Date("2026-11-01T04:30:00Z"), 200_000),
        ],
      }),
    );

    expect(data.wonByMonth).toEqual([
      { month: "2026-09", valueCents: 0, count: 0 },
      { month: "2026-10", valueCents: 500_000, count: 1 },
      { month: "2026-11", valueCents: 200_000, count: 1 },
    ]);
  });

  it("averages whole days from created to won", async () => {
    const data = await load(
      fakeDb({
        won: [
          won(zonedDateTime("2026-10-11", "16:00"), 100, zonedDateTime("2026-10-01", "09:00")),
          won(zonedDateTime("2026-10-09", "08:00"), 100, zonedDateTime("2026-10-05", "17:30")),
          // Won on the day it was made: 0 days.
          won(zonedDateTime("2026-11-02", "16:00"), 100, zonedDateTime("2026-11-02", "09:00")),
          // 0 and 3 days average 1.5, shown as a whole 2.
          won(zonedDateTime("2026-11-04", "10:00"), 100, zonedDateTime("2026-11-01", "10:00")),
        ],
      }),
    );

    expect(data.cycleByMonth).toEqual([
      { month: "2026-09", avgDays: null, count: 0 },
      { month: "2026-10", avgDays: 7, count: 2 },
      { month: "2026-11", avgDays: 2, count: 2 },
    ]);
  });

  it("counts calendar days in Eastern time across a clock change", async () => {
    // Made 11:30 PM Sat Oct 31 (EDT), won 12:30 AM Mon Nov 2 (EST): 2 calendar days, though UTC dates say 1.
    const acrossTheChange = await load(fakeDb({ won: [won(new Date("2026-11-02T05:30:00Z"), 100, new Date("2026-11-01T03:30:00Z"))] }));
    expect(acrossTheChange.cycleByMonth[2]).toEqual({ month: "2026-11", avgDays: 2, count: 1 });

    // Made 12:30 AM Nov 3, won 11:30 PM the same day (Eastern): 0 days, though UTC dates say 1.
    const sameDay = await load(fakeDb({ won: [won(new Date("2026-11-04T04:30:00Z"), 100, new Date("2026-11-03T05:30:00Z"))] }));
    expect(sameDay.cycleByMonth[2]).toEqual({ month: "2026-11", avgDays: 0, count: 1 });
  });

  it("the funnel shows open deals per stage now", async () => {
    const db = fakeDb({
      funnel: [
        { stageId: "s3", _count: { _all: 2 }, _sum: { valueCents: 2_880_000 } },
        { stageId: "s1", _count: { _all: 5 }, _sum: { valueCents: null } },
        // A deal in a stage that is no longer live is not drawn.
        { stageId: "s-old", _count: { _all: 1 }, _sum: { valueCents: 100 } },
      ],
    });
    const data = await load(db, query({ pipeline: "gone" }));

    expect(db.salesPipeline.findMany.mock.calls[0][0]).toMatchObject({
      where: { archivedAt: null, kind: { in: ["SALES", "CONSULTING"] } },
      orderBy: { position: "asc" },
    });
    expect(data.pipelines).toEqual(PIPELINES);
    // An unknown key falls back to the first pipeline.
    expect(data.pipeline).toEqual(PIPELINES[0]);
    expect(db.salesStage.findMany.mock.calls[0][0]).toMatchObject({
      where: { pipelineId: "pm1", archivedAt: null },
      orderBy: { position: "asc" },
    });
    expect(db.salesDeal.groupBy.mock.calls).toEqual([
      [
        {
          by: ["stageId"],
          where: { archivedAt: null, status: "OPEN", pipelineId: "pm1", ownerId: "r" },
          _count: { _all: true },
          _sum: { valueCents: true },
        },
      ],
    ]);
    expect(data.funnel).toEqual([
      { stageId: "s1", name: "New Opt-In", count: 5, valueCents: 0 },
      { stageId: "s2", name: "Demo", count: 0, valueCents: 0 },
      { stageId: "s3", name: "Proposal Sent", count: 2, valueCents: 2_880_000 },
      { stageId: "s4", name: "Contract Signed", count: 0, valueCents: 0 },
    ]);

    // A named pipeline is used; an admin on Everyone has no owner on the funnel.
    const named = fakeDb();
    const second = await load(named, query({ pipeline: "new-mover-mail" }), admin);
    expect(second.pipeline).toEqual(PIPELINES[1]);
    expect(named.salesDeal.groupBy.mock.calls[0][0].where).toEqual({ archivedAt: null, status: "OPEN", pipelineId: "pm2" });

    // No Sales pipeline at all: no funnel and no funnel reads.
    const none = fakeDb({ pipelines: [] });
    const empty = await load(none);
    expect(empty.pipeline).toBeNull();
    expect(empty.funnel).toEqual([]);
    expect(none.salesDeal.groupBy).not.toHaveBeenCalled();
    expect(none.salesStage.findMany).not.toHaveBeenCalled();
  });

  it("counts activities done per person", async () => {
    const db = fakeDb({
      done: [
        { ownerId: "gone", _count: { _all: 4 } },
        { ownerId: "b", _count: { _all: 4 } },
        { ownerId: "r", _count: { _all: 9 } },
      ],
    });
    const data = await load(db);

    expect(db.salesActivity.groupBy.mock.calls).toEqual([
      [
        {
          by: ["ownerId"],
          where: { doneAt: { gte: startOfDay("2026-09-01") }, archivedAt: null, ...doneParents({ ownerId: "r" }) },
          _count: { _all: true },
        },
      ],
    ]);
    // Highest first, then by name; someone who left Sales still counts.
    expect(data.activitiesByPerson).toEqual([
      { ownerId: "r", name: "Rachel P.", count: 9 },
      { ownerId: "b", name: "Ben S.", count: 4 },
      { ownerId: "gone", name: "No longer in Sales", count: 4 },
    ]);
    expect(data.canSeeEveryone).toBe(false);
    expect(data.query).toEqual(query());

    // Just me: the activities the person did.
    const mine = fakeDb();
    await load(mine, query({ scope: "mine" }));
    expect(mine.salesActivity.groupBy.mock.calls[0][0].where).toEqual({
      doneAt: { gte: startOfDay("2026-09-01") },
      archivedAt: null,
      ownerId: "r",
      ...doneParents({ ownerId: "r" }),
    });

    // An admin on Everyone: every deal and lead.
    const everyone = fakeDb();
    const adminData = await load(everyone, query(), admin);
    expect(everyone.salesActivity.groupBy.mock.calls[0][0].where).toEqual({
      doneAt: { gte: startOfDay("2026-09-01") },
      archivedAt: null,
      ...doneParents({}),
    });
    expect(adminData.canSeeEveryone).toBe(true);
  });
});
