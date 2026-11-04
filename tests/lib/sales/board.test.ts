import { describe, expect, it, vi } from "vitest";

// The Deals board and list read model, run against a small fake database whose
// delegates record every call, so the tests can check the exact queries (the
// who-can-see filter, limits, ordering) as well as what the page gets back.
// The default `prisma` import is mocked only so loading the modules stays inert.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { boardDealWhere, loadBoardPage, loadDealListPage, loadSalesMembers } = await import("@/lib/sales/board");
const { parseBoardQuery } = await import("@/lib/sales/board-query");
const { SALES_MEMBER_WHERE } = await import("@/lib/sales/access");
const { endOfDay, startOfDay } = await import("@/lib/utils");

type SalesActor = import("@/lib/sales/access").SalesActor;
type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };

const now = new Date("2026-11-05T15:00:00Z");
const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const admin: SalesActor = { userId: "a", isAdmin: true, seesAllDeals: true, via: "user" };
const query = (params: Record<string, string> = {}) => parseBoardQuery(params);

const PIPELINES = [
  { id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES" },
  { id: "p2", key: "marketing-agency", name: "Marketing Agency", kind: "CONSULTING" },
];
const stage = (id: string, name: string, position: number, extra: Row = {}) => ({
  id,
  key: id,
  name,
  position,
  probability: 10,
  isWon: false,
  isLost: false,
  requiresValue: false,
  isNoShow: false,
  rottingDays: 14,
  ...extra,
});
const STAGES = [stage("s1", "Lead In", 1), stage("s2", "Proposal Sent", 2, { requiresValue: true, probability: 50 })];

const deal = (id: string, extra: Row = {}) => ({
  id,
  title: `Deal ${id}`,
  valueCents: 100_000,
  mrrCents: 10_000,
  stageId: "s1",
  status: "OPEN",
  stageEnteredAt: new Date("2026-11-01T15:00:00Z"),
  ownerId: "r",
  person: { name: "Sarah K." },
  organization: { name: "Oak Creek Dental" },
  stage: { name: "Lead In" },
  ...extra,
});
const deals = (count: number) => Array.from({ length: count }, (_, i) => deal(`d${i + 1}`));

function fakeDb(
  opts: {
    pipelines?: Row[];
    dealsByStage?: Record<string, Row[]>;
    listRows?: Row[];
    groups?: Row[];
    aggregate?: Row;
    activities?: Row[];
  } = {},
) {
  return {
    salesPipeline: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.pipelines ?? PIPELINES) },
    salesStage: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => STAGES) },
    salesDeal: {
      findMany: vi.fn(async (args: Args) =>
        typeof args.where.stageId === "string" ? (opts.dealsByStage?.[args.where.stageId] ?? []) : (opts.listRows ?? []),
      ),
      groupBy: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.groups ?? []),
      aggregate: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.aggregate ?? { _count: { _all: 0 }, _sum: { valueCents: null } }),
    },
    salesActivity: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.activities ?? []) },
    teamMember: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => [{ id: "r", name: "Rachel P." }]) },
  };
}
type FakeDb = ReturnType<typeof fakeDb>;

/** Every `where` the deal queries were given, from all three kinds of call. */
function dealWheres(db: FakeDb): Row[] {
  return [
    ...db.salesDeal.findMany.mock.calls,
    ...db.salesDeal.groupBy.mock.calls,
    ...db.salesDeal.aggregate.mock.calls,
  ].map(([args]) => args.where);
}

describe("pipelines", () => {
  it("reads only open Sales and Consulting pipelines, in order", async () => {
    const db = fakeDb();
    await loadBoardPage(rep, query(), now, db as never);

    expect(db.salesPipeline.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesPipeline.findMany.mock.calls[0][0]).toMatchObject({
      where: { archivedAt: null, kind: { in: ["SALES", "CONSULTING"] } },
      orderBy: { position: "asc" },
    });
  });

  it("returns null when there is no pipeline at all", async () => {
    const db = fakeDb({ pipelines: [] });

    expect(await loadBoardPage(rep, query(), now, db as never)).toBeNull();
    expect(db.salesDeal.findMany).not.toHaveBeenCalled();
  });

  it("opens the pipeline the URL names", async () => {
    const db = fakeDb();
    const page = await loadBoardPage(rep, query({ pipeline: "marketing-agency" }), now, db as never);

    expect(page?.pipeline).toEqual(PIPELINES[1]);
    expect(db.salesStage.findMany.mock.calls[0][0].where).toEqual({ pipelineId: "p2", archivedAt: null });
  });

  it("falls back to the first pipeline when the URL names one that is gone", async () => {
    const db = fakeDb();
    const page = await loadBoardPage(rep, query({ pipeline: "gone" }), now, db as never);

    expect(page?.pipeline).toEqual(PIPELINES[0]);
    expect(page?.pipelines).toEqual(PIPELINES);
    expect(db.salesStage.findMany.mock.calls[0][0]).toMatchObject({
      where: { pipelineId: "p1", archivedAt: null },
      orderBy: { position: "asc" },
    });
    for (const where of dealWheres(db)) expect(where.pipelineId).toBe("p1");
  });
});

describe("who can see which deals", () => {
  it("limits a person set to their own deals, in board and list view", async () => {
    for (const view of ["board", "list"]) {
      const db = fakeDb();
      await loadBoardPage(rep, query({ view }), now, db as never);

      const wheres = dealWheres(db);
      expect(wheres.length).toBeGreaterThan(0);
      for (const where of wheres) {
        expect(where, view).toMatchObject({ archivedAt: null, pipelineId: "p1", status: "OPEN", ownerId: "r" });
      }
    }
  });

  it("shows an admin everyone's deals, or only their own with Just me", async () => {
    const everyone = fakeDb();
    await loadBoardPage(admin, query(), now, everyone as never);
    for (const where of dealWheres(everyone)) expect(where).not.toHaveProperty("ownerId");

    const mine = fakeDb();
    await loadBoardPage(admin, query({ scope: "mine" }), now, mine as never);
    for (const where of dealWheres(mine)) expect(where.ownerId).toBe("a");
  });

  it("says whether the Everyone / Just me switch applies", async () => {
    expect((await loadBoardPage(rep, query(), now, fakeDb() as never))?.canSeeEveryone).toBe(false);
    expect((await loadBoardPage(admin, query(), now, fakeDb() as never))?.canSeeEveryone).toBe(true);
    const seesAll: SalesActor = { ...rep, seesAllDeals: true };
    expect((await loadBoardPage(seesAll, query(), now, fakeDb() as never))?.canSeeEveryone).toBe(true);
  });
});

describe("boardDealWhere", () => {
  it("maps the status filter", () => {
    expect(boardDealWhere(rep, query({ status: "won" }), "p1", now).status).toBe("WON");
    expect(boardDealWhere(rep, query({ status: "lost" }), "p1", now).status).toBe("LOST");
    expect(boardDealWhere(rep, query(), "p1", now)).toEqual({ pipelineId: "p1", archivedAt: null, status: "OPEN", ownerId: "r" });
  });

  it("finds deals with no next step", () => {
    expect(boardDealWhere(rep, query({ next: "none" }), "p1", now)).toMatchObject({
      activities: { none: { doneAt: null, archivedAt: null } },
    });
  });

  it("finds deals with an overdue step, by the team's calendar day", () => {
    expect(boardDealWhere(rep, query({ next: "overdue" }), "p1", now)).toMatchObject({
      activities: { some: { doneAt: null, archivedAt: null, dueAt: { lt: startOfDay("2026-11-05") } } },
    });
  });

  it("finds deals whose next step is today (something due today, nothing overdue)", () => {
    expect(boardDealWhere(rep, query({ next: "today" }), "p1", now)).toMatchObject({
      activities: {
        some: { doneAt: null, archivedAt: null, dueAt: { gte: startOfDay("2026-11-05"), lte: endOfDay("2026-11-05") } },
        none: { doneAt: null, archivedAt: null, dueAt: { lt: startOfDay("2026-11-05") } },
      },
    });
  });

  it("searches the deal title, organization name and person name", () => {
    const contains = { contains: "oak", mode: "insensitive" };
    expect(boardDealWhere(rep, query({ q: "oak" }), "p1", now)).toMatchObject({
      OR: [{ title: contains }, { organization: { name: contains } }, { person: { name: contains } }],
    });
    expect(boardDealWhere(rep, query(), "p1", now)).not.toHaveProperty("OR");
  });
});

describe("board view", () => {
  it("loads each column newest-in-stage first, 50 cards at most", async () => {
    const db = fakeDb();
    await loadBoardPage(rep, query(), now, db as never);

    expect(db.salesDeal.findMany).toHaveBeenCalledTimes(STAGES.length);
    expect(db.salesDeal.findMany.mock.calls.map(([args]) => args.where.stageId)).toEqual(["s1", "s2"]);
    for (const [args] of db.salesDeal.findMany.mock.calls) {
      expect(args).toMatchObject({ take: 50, orderBy: [{ stageEnteredAt: "desc" }, { id: "desc" }] });
    }
  });

  it("counts and totals each column from one groupBy, past the 50 cards shown", async () => {
    const db = fakeDb({
      dealsByStage: { s1: deals(50) },
      groups: [{ stageId: "s1", _count: { _all: 73 }, _sum: { valueCents: 7_300_000 } }],
    });
    const page = await loadBoardPage(rep, query(), now, db as never);

    expect(db.salesDeal.groupBy).toHaveBeenCalledTimes(1);
    expect(db.salesDeal.groupBy.mock.calls[0][0]).toMatchObject({
      by: ["stageId"],
      _count: { _all: true },
      _sum: { valueCents: true },
    });
    expect(page?.columns?.map((column) => [column.stage.id, column.count, column.totalCents, column.cards.length])).toEqual([
      ["s1", 73, 7_300_000, 50],
      ["s2", 0, 0, 0],
    ]);
    expect(page?.totals).toEqual({ count: 73, valueCents: 7_300_000 });
    expect(page?.list).toBeNull();
  });

  it("gives the stages as the board shows them", async () => {
    const page = await loadBoardPage(rep, query(), now, fakeDb() as never);

    expect(page?.stages).toEqual(STAGES);
    expect(page?.columns?.[1].stage).toEqual(STAGES[1]);
  });

  it("never selects a person's email or phone", async () => {
    for (const view of ["board", "list"]) {
      const db = fakeDb();
      await loadBoardPage(rep, query({ view }), now, db as never);
      for (const [args] of db.salesDeal.findMany.mock.calls) {
        const select = JSON.stringify(args.select);
        expect(select).not.toContain('"email"');
        expect(select).not.toContain('"phone"');
      }
    }
  });

  it("builds each card with its earliest open activity as the next step", async () => {
    const db = fakeDb({
      dealsByStage: { s1: [deal("d1"), deal("d2", { person: null, organization: null })] },
      activities: [
        { dealId: "d1", type: "MEETING", subject: "Demo", dueAt: endOfDay("2026-11-07") },
        { dealId: "d1", type: "CALL", subject: "First call", dueAt: endOfDay("2026-11-06") },
      ],
    });
    const page = await loadBoardPage(rep, query(), now, db as never);

    expect(db.salesActivity.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesActivity.findMany.mock.calls[0][0].where).toEqual({
      dealId: { in: ["d1", "d2"] },
      doneAt: null,
      archivedAt: null,
    });
    expect(page?.columns?.[0].cards).toEqual([
      {
        id: "d1",
        title: "Deal d1",
        valueCents: 100_000,
        mrrCents: 10_000,
        stageId: "s1",
        status: "OPEN",
        stageEnteredAt: "2026-11-01T15:00:00.000Z",
        ownerId: "r",
        personName: "Sarah K.",
        organizationName: "Oak Creek Dental",
        next: { type: "CALL", subject: "First call", dueAt: endOfDay("2026-11-06").toISOString() },
      },
      expect.objectContaining({ id: "d2", personName: null, organizationName: null, next: null }),
    ]);
  });

  it("skips the activity lookup when no deal is shown", async () => {
    const db = fakeDb();
    await loadBoardPage(rep, query(), now, db as never);

    expect(db.salesActivity.findMany).not.toHaveBeenCalled();
  });

  it("lists the team members who can own deals", async () => {
    const db = fakeDb();
    const page = await loadBoardPage(rep, query(), now, db as never);

    expect(page?.members).toEqual([{ id: "r", name: "Rachel P." }]);
    expect(db.teamMember.findMany.mock.calls[0][0]).toMatchObject({ where: SALES_MEMBER_WHERE, select: { id: true, name: true } });
    expect(await loadSalesMembers(db as never)).toEqual([{ id: "r", name: "Rachel P." }]);
  });

  it("keeps the query it was given", async () => {
    const q = query({ pipeline: "gone", next: "none" });
    expect((await loadBoardPage(rep, q, now, fakeDb() as never))?.query).toEqual(q);
  });
});

describe("list view", () => {
  it("loads the first page, most recently updated first", async () => {
    const db = fakeDb({
      listRows: deals(51),
      aggregate: { _count: { _all: 120 }, _sum: { valueCents: 12_000_000 } },
    });
    const page = await loadBoardPage(rep, query({ view: "list", cursor: "d50" }), now, db as never);

    expect(db.salesDeal.findMany).toHaveBeenCalledTimes(1);
    const args = db.salesDeal.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ take: 51, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] });
    // loadBoardPage always shows the first page, whatever cursor the URL had.
    expect(args).not.toHaveProperty("cursor");
    expect(args).not.toHaveProperty("skip");
    expect(db.salesDeal.groupBy).not.toHaveBeenCalled();
    expect(page?.columns).toBeNull();
    expect(page?.list?.rows).toHaveLength(50);
    expect(page?.list?.nextCursor).toBe("d50");
    expect(page?.list?.rows[0]).toMatchObject({ id: "d1", stageName: "Lead In", personName: "Sarah K." });
    expect(page?.totals).toEqual({ count: 120, valueCents: 12_000_000 });
  });

  it("totals zero when nothing matches", async () => {
    const page = await loadBoardPage(rep, query({ view: "list" }), now, fakeDb() as never);

    expect(page?.totals).toEqual({ count: 0, valueCents: 0 });
    expect(page?.list).toEqual({ rows: [], nextCursor: null });
  });
});

describe("loadDealListPage", () => {
  it("continues after the cursor with the same filter, order and size", async () => {
    const db = fakeDb({ listRows: deals(12) });
    const page = await loadDealListPage(rep, query({ view: "list", cursor: "d50" }), now, db as never);

    expect(db.salesDeal.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesDeal.findMany.mock.calls[0][0]).toMatchObject({
      where: { pipelineId: "p1", archivedAt: null, status: "OPEN", ownerId: "r" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 51,
      cursor: { id: "d50" },
      skip: 1,
    });
    expect(page?.rows).toHaveLength(12);
    expect(page?.nextCursor).toBeNull();
  });

  it("falls back to the first pipeline like the board does", async () => {
    const db = fakeDb();
    await loadDealListPage(rep, query({ pipeline: "gone" }), now, db as never);

    expect(db.salesDeal.findMany.mock.calls[0][0].where.pipelineId).toBe("p1");
  });

  it("returns null when there is no pipeline", async () => {
    expect(await loadDealListPage(rep, query(), now, fakeDb({ pipelines: [] }) as never)).toBeNull();
  });
});
