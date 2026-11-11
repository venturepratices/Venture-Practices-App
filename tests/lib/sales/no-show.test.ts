import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The daily missed-meeting rule (spec rule 5, Decision 1) and its cron route,
// against a small fake database whose delegates record every call. Checks the
// bounded meeting query, the move into No Show, the missed meeting and the one
// reschedule call per deal, that each deal is its own transaction, and that the
// route refuses anyone without the cron secret. Nothing here reaches a real
// database, Slack or email.

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; data: Row; select?: Row; [key: string]: unknown };

// 7 AM Eastern on Friday Nov 6, when the cron runs.
const now = new Date("2026-11-06T12:00:00Z");

const STAGE_NAMES: Record<string, { name: string; position: number }> = {
  s1: { name: "New Opt-In", position: 1 },
  s2: { name: "Appointment Scheduled", position: 2 },
  s3: { name: "No Show", position: 3 },
  s4: { name: "Demo Complete", position: 4 },
  n3: { name: "Demo Scheduled", position: 3 },
  n4: { name: "No Show/Cancel", position: 4 },
};

const deal = (id: string, stageId: string, extra: Row = {}): Row => ({
  id,
  pipelineId: "p1",
  stageId,
  ownerId: "r",
  personId: `person-${id}`,
  status: "OPEN",
  archivedAt: null,
  ...extra,
});

const meeting = (id: string, dealId: string, extra: Row = {}): Row => ({
  id,
  dealId,
  type: "MEETING",
  subject: "Demo",
  dueAt: endOfDay("2026-11-05"),
  doneAt: null,
  archivedAt: null,
  createdBy: "r",
  ...extra,
});

const state = {
  noShowStages: [] as Row[],
  deals: [] as Row[],
  /** What the bounded meeting query returns (the filtering itself is checked on the call's arguments). */
  missed: [] as Row[],
  /** Open activities the reschedule check can find. */
  open: [] as Row[],
  /** Deal ids whose transaction blows up, to prove one bad deal does not stop the rest. */
  failing: new Set<string>(),
  audits: [] as Row[],
};

const db = {
  salesStage: { findMany: vi.fn<(args: Args) => Promise<Row[]>>(async () => state.noShowStages) },
  salesActivity: {
    findMany: vi.fn(async (args: Args) => {
      if (args.where.type === "MEETING" && args.where.id) {
        // The re-read inside a deal's transaction: the named meetings that are still open.
        const ids = (args.where.id as { in: string[] }).in;
        return state.missed.filter((m) => ids.includes(m.id as string) && m.doneAt === null && m.archivedAt === null);
      }
      if (args.where.type === "MEETING") return state.missed;
      const createdBy = (args.where.createdBy as { in: string[] }).in;
      return state.open.filter(
        (a) => a.dealId === args.where.dealId && createdBy.includes(a.createdBy as string) && a.doneAt === null && a.archivedAt === null,
      );
    }),
    // Like Postgres: only the named meetings still open are marked, and the marked rows come back.
    updateManyAndReturn: vi.fn(async (args: Args) => {
      const ids = (args.where.id as { in: string[] }).in;
      return state.missed
        .filter((m) => ids.includes(m.id as string) && m.doneAt === null && m.archivedAt === null)
        .map((m) => ({ id: m.id }));
    }),
    create: vi.fn(async (args: Args) => ({ id: `call-${args.data.dealId}`, ...args.data })),
  },
  salesDeal: {
    findFirst: vi.fn(async (args: Args) => {
      if (state.failing.has(args.where.id as string)) throw new Error("connection reset");
      const row = state.deals.find(
        (d) => d.id === args.where.id && d.status === args.where.status && d.archivedAt === args.where.archivedAt,
      );
      return row ? { ...row, stage: { name: STAGE_NAMES[row.stageId as string].name, position: STAGE_NAMES[row.stageId as string].position } } : null;
    }),
    // Like Postgres: the move lands only while the deal is still as the rule checked it.
    updateMany: vi.fn(async (args: Args) => {
      const row = state.deals.find(
        (d) =>
          d.id === args.where.id &&
          d.status === args.where.status &&
          d.archivedAt === args.where.archivedAt &&
          d.stageId === args.where.stageId,
      );
      return { count: row ? 1 : 0 };
    }),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => state.audits.push(args.data)) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { applyMissedMeetingRule } = await import("@/lib/sales/no-show");
const cronRoute = await import("@/app/api/cron/sales-no-show/route");
const { endOfDay, startOfDay } = await import("@/lib/utils");

const writes = () => [
  ...db.salesDeal.updateMany.mock.calls,
  ...db.salesActivity.create.mock.calls,
  ...db.salesActivity.updateManyAndReturn.mock.calls,
  ...db.salesAuditLog.create.mock.calls,
];
const auditsFor = (dealId: string) => state.audits.filter((row) => row.entityId === dealId).map((row) => row.action);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const delegate of Object.values(db)) {
    if (typeof delegate === "function") delegate.mockClear();
    else for (const fn of Object.values(delegate)) fn.mockClear();
  }
  state.noShowStages = [
    { id: "s3", pipelineId: "p1", name: "No Show", position: 3 },
    { id: "n4", pipelineId: "p2", name: "No Show/Cancel", position: 4 },
  ];
  state.deals = [deal("d1", "s2")];
  state.missed = [meeting("m1", "d1")];
  state.open = [];
  state.failing = new Set();
  state.audits = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
});

describe("applyMissedMeetingRule", () => {
  it("looks for missed meetings with one bounded query, before each pipeline's No Show stage", async () => {
    await applyMissedMeetingRule(now, db as never);

    expect(db.salesStage.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesStage.findMany.mock.calls[0][0]).toMatchObject({
      where: { isNoShow: true, archivedAt: null, pipeline: { archivedAt: null } },
    });

    expect(db.salesActivity.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        type: "MEETING",
        doneAt: null,
        archivedAt: null,
        dueAt: { lt: startOfDay("2026-11-06") },
        deal: { status: "OPEN", archivedAt: null },
        OR: [
          { deal: { pipelineId: "p1", stage: { position: { lt: 3 } } } },
          { deal: { pipelineId: "p2", stage: { position: { lt: 4 } } } },
        ],
      },
      orderBy: { dueAt: "asc" },
      take: 200,
    });
  });

  it("moves the deal to No Show, marks the meeting missed and adds the reschedule call", async () => {
    const result = await applyMissedMeetingRule(now, db as never);

    expect(result).toEqual({ moved: 1, meetingsMarked: 1 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.salesDeal.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", status: "OPEN", archivedAt: null });

    // The move lands only on the deal as the rule checked it: still open, not deleted, in the same stage.
    expect(db.salesDeal.updateMany.mock.calls).toEqual([
      [{ where: { id: "d1", status: "OPEN", archivedAt: null, stageId: "s2" }, data: { stageId: "s3", stageEnteredAt: now } }],
    ]);
    expect(db.salesActivity.findMany.mock.calls[1][0].where).toEqual({
      id: { in: ["m1"] },
      type: "MEETING",
      doneAt: null,
      archivedAt: null,
    });
    // Only meetings still not done are marked, and the write says which.
    expect(db.salesActivity.updateManyAndReturn.mock.calls).toEqual([
      [
        {
          where: { id: { in: ["m1"] }, type: "MEETING", doneAt: null, archivedAt: null },
          data: { archivedAt: now },
          select: { id: true },
        },
      ],
    ]);
    expect(db.salesActivity.create.mock.calls[0][0].data).toEqual({
      type: "CALL",
      subject: "Reschedule the missed demo",
      dueAt: endOfDay("2026-11-06"),
      hasTime: false,
      ownerId: "r",
      createdBy: "rule:no-show",
      dealId: "d1",
      personId: "person-d1",
    });

    expect(auditsFor("d1")).toEqual(["stage_changed", "activity_missed", "activity_added"]);
    for (const row of state.audits) {
      expect(row).toMatchObject({ actorType: "SYSTEM", actorId: null, botTokenId: null, ipAddress: null, userAgent: null });
      expect(row.entityType).toBe("SalesDeal");
    }
    expect(state.audits[0].before).toEqual({ stageId: "s2", stageName: "Appointment Scheduled" });
    expect(state.audits[0].after).toEqual({ stageId: "s3", stageName: "No Show" });
    expect(state.audits[1].after).toEqual({ activityId: "m1", type: "MEETING", subject: "Demo" });
    expect(state.audits[2].after).toEqual({
      activityId: "call-d1",
      type: "CALL",
      subject: "Reschedule the missed demo",
      dueAt: endOfDay("2026-11-06").toISOString(),
      hasTime: false,
      createdBy: "rule:no-show",
    });
  });

  it("moves a deal with two missed meetings once, marks both and adds one call", async () => {
    state.missed = [meeting("m1", "d1"), meeting("m2", "d1", { subject: "Second try", dueAt: endOfDay("2026-11-04") })];
    const result = await applyMissedMeetingRule(now, db as never);

    expect(result).toEqual({ moved: 1, meetingsMarked: 2 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.salesDeal.updateMany).toHaveBeenCalledTimes(1);
    expect(db.salesActivity.updateManyAndReturn.mock.calls[0][0].where).toEqual({
      id: { in: ["m1", "m2"] },
      type: "MEETING",
      doneAt: null,
      archivedAt: null,
    });
    expect(db.salesActivity.create).toHaveBeenCalledTimes(1);
    expect(auditsFor("d1")).toEqual(["stage_changed", "activity_missed", "activity_missed", "activity_added"]);
    expect(state.audits[2].after).toEqual({ activityId: "m2", type: "MEETING", subject: "Second try" });
  });

  it("does not add a second reschedule call while the rule's call is still open", async () => {
    state.open = [{ id: "call-open", dealId: "d1", createdBy: "rule:no-show", doneAt: null, archivedAt: null }];
    const result = await applyMissedMeetingRule(now, db as never);

    expect(result).toEqual({ moved: 1, meetingsMarked: 1 });
    expect(db.salesActivity.create).not.toHaveBeenCalled();
    expect(auditsFor("d1")).toEqual(["stage_changed", "activity_missed"]);
  });

  it("runs no meeting query when no pipeline has a No Show stage", async () => {
    state.noShowStages = [];
    const result = await applyMissedMeetingRule(now, db as never);

    expect(result).toEqual({ moved: 0, meetingsMarked: 0 });
    expect(db.salesActivity.findMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("gives each deal its own transaction, so one bad deal does not stop the others", async () => {
    state.deals = [deal("d1", "s2"), deal("d2", "s1", { ownerId: "b" }), deal("d3", "n3", { pipelineId: "p2" })];
    state.missed = [meeting("m1", "d1"), meeting("m2", "d2"), meeting("m3", "d3")];
    state.failing = new Set(["d2"]);
    const result = await applyMissedMeetingRule(now, db as never);

    expect(result).toEqual({ moved: 2, meetingsMarked: 2 });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(auditsFor("d1")).toEqual(["stage_changed", "activity_missed", "activity_added"]);
    expect(auditsFor("d2")).toEqual([]);
    // The other pipeline's deal goes to that pipeline's own No Show stage.
    expect(db.salesDeal.updateMany.mock.calls.map(([args]) => [args.where.id, args.data.stageId])).toEqual([
      ["d1", "s3"],
      ["d3", "n4"],
    ]);
    expect(state.audits.find((row) => row.entityId === "d3" && row.action === "stage_changed")?.after).toEqual({
      stageId: "n4",
      stageName: "No Show/Cancel",
    });
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("skips a deal that was closed or moved to No Show or later before its turn", async () => {
    state.deals = [deal("d1", "s2", { status: "WON" }), deal("d2", "s4")];
    state.missed = [meeting("m1", "d1"), meeting("m2", "d2")];
    const result = await applyMissedMeetingRule(now, db as never);

    expect(result).toEqual({ moved: 0, meetingsMarked: 0 });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(writes()).toEqual([]);
  });

  it("leaves a deal alone when its meeting was marked done before its turn", async () => {
    // The meeting query (canned) still lists it; the re-read inside the deal's transaction sees it done.
    state.missed = [meeting("m1", "d1", { doneAt: now })];
    const result = await applyMissedMeetingRule(now, db as never);

    expect(result).toEqual({ moved: 0, meetingsMarked: 0 });
    expect(writes()).toEqual([]);
  });
});

describe("applyMissedMeetingRule: a person acting on the deal at the same moment", () => {
  it("never moves a deal back that a person moved, closed or deleted after the rule read it (Decision 1)", async () => {
    // A rep's move to Demo Complete commits between the rule's re-read and its write.
    db.salesDeal.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await applyMissedMeetingRule(now, db as never);

    expect(result).toEqual({ moved: 0, meetingsMarked: 0 });
    expect(db.salesActivity.updateManyAndReturn).not.toHaveBeenCalled();
    expect(db.salesActivity.create).not.toHaveBeenCalled();
    expect(state.audits).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("neither marks nor logs a meeting ticked done after the rule read it", async () => {
    state.missed = [meeting("m1", "d1"), meeting("m2", "d1", { subject: "Second try" })];
    // m2 is ticked done between the re-read and the write, so the write marks only m1.
    db.salesActivity.updateManyAndReturn.mockResolvedValueOnce([{ id: "m1" }]);
    const result = await applyMissedMeetingRule(now, db as never);

    expect(result).toEqual({ moved: 1, meetingsMarked: 1 });
    expect(auditsFor("d1")).toEqual(["stage_changed", "activity_missed", "activity_added"]);
    expect(state.audits[1].after).toEqual({ activityId: "m1", type: "MEETING", subject: "Demo" });
  });

  it("undoes the move when every meeting was ticked done after the rule read it", async () => {
    db.salesActivity.updateManyAndReturn.mockResolvedValueOnce([]);
    const result = await applyMissedMeetingRule(now, db as never);

    expect(result).toEqual({ moved: 0, meetingsMarked: 0 });
    // The deal's transaction is rolled back (it throws), so its move to No Show never lands.
    await expect(db.$transaction.mock.results[0].value).rejects.toThrow();
    expect(db.salesActivity.create).not.toHaveBeenCalled();
    expect(state.audits).toEqual([]);
    // A rollback on purpose, not a failure worth logging.
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/sales-no-show", () => {
  const get = (headers: Record<string, string> = {}) =>
    cronRoute.GET(new Request("http://localhost/api/cron/sales-no-show", { headers }));

  it("answers 401 without the cron secret, and runs nothing", async () => {
    process.env.CRON_SECRET = "s3cret";
    const missing = await get();
    expect(missing.status).toBe(401);

    const wrong = await get({ authorization: "Bearer nope" });
    expect(wrong.status).toBe(401);

    expect(db.salesStage.findMany).not.toHaveBeenCalled();
    expect(db.salesActivity.findMany).not.toHaveBeenCalled();
  });

  it("answers 401 when CRON_SECRET is not set, even to a matching-looking header", async () => {
    delete process.env.CRON_SECRET;
    const res = await get({ authorization: "Bearer undefined" });

    expect(res.status).toBe(401);
    expect(db.salesStage.findMany).not.toHaveBeenCalled();
  });

  it("runs the rule with the right secret and answers with the counts", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await get({ authorization: "Bearer s3cret" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, moved: 1, meetingsMarked: 1 });
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({ stageId: "s3", stageEnteredAt: now });
    expect(cronRoute.runtime).toBe("nodejs");
    expect(cronRoute.dynamic).toBe("force-dynamic");
  });
});
