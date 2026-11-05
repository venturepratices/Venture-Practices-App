import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Moving deals between stages and marking them won, lost or open again, through
// their routes, against a small fake database whose delegates record every call
// and a fake Sales gate. Checks the money rule against stored values, the No
// Show rule's reschedule call (never twice), the undo of that call, and the
// exact locked history rows each change writes. Nothing here reaches a real
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

const now = new Date("2026-11-05T15:00:00Z");
const enteredEarlier = new Date("2026-10-30T14:00:00Z");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "b", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };

const stage = (id: string, pipelineId: string, name: string, position: number, extra: Row = {}): Row => ({
  id,
  pipelineId,
  name,
  position,
  isWon: false,
  isLost: false,
  isNoShow: false,
  requiresValue: false,
  archivedAt: null,
  ...extra,
});

// Direct Mail (p1), plus one stage from another pipeline and one archived stage.
const STAGES: Row[] = [
  stage("s1", "p1", "New Opt-In", 1),
  stage("s2", "p1", "Appointment Scheduled", 2),
  stage("s3", "p1", "No Show", 3, { isNoShow: true }),
  stage("s4", "p1", "Demo Complete", 4),
  stage("s5", "p1", "Proposal Sent", 5, { requiresValue: true }),
  stage("s6", "p1", "Follow-Up", 6),
  stage("s7", "p1", "Contract Signed", 7, { isWon: true }),
  stage("s8", "p1", "Old Stage", 8, { archivedAt: new Date("2026-01-01T00:00:00Z") }),
  stage("x1", "p2", "Discovery Call", 1),
];

const stageName = (id: unknown) => STAGES.find((s) => s.id === id)?.name;

const baseDeal = (extra: Row = {}): Row => ({
  id: "d1",
  title: "Oak Creek Family Dentistry",
  pipelineId: "p1",
  stageId: "s4",
  ownerId: "r",
  personId: "pe1",
  valueCents: 0,
  mrrCents: 0,
  status: "OPEN",
  wonAt: null,
  lostAt: null,
  lostReason: null,
  lostComment: null,
  stageEnteredAt: enteredEarlier,
  archivedAt: null,
  ...extra,
});

const state = {
  deal: null as Row | null,
  activities: [] as Row[],
  /** History rows written before the request under test, oldest first. */
  history: [] as Row[],
  audits: [] as Row[],
};

/** Only the selected keys of a row, like Prisma's `select` (nested selects return the related row as is). */
const selected = (row: Row, select?: Row) =>
  select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row;

/** The stored deal as Prisma returns it, with its stage relation filled in. */
const storedDeal = (): Row | null =>
  state.deal ? { ...state.deal, stage: { name: stageName(state.deal.stageId) } } : null;

/** A small `where` matcher for activities: plain equality, or `{ in: [...] }`. */
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, condition]) => {
    if (condition !== null && typeof condition === "object" && "in" in (condition as Row)) {
      return ((condition as { in: unknown[] }).in).includes(row[key]);
    }
    return row[key] === condition;
  });

const db = {
  salesDeal: {
    findFirst: vi.fn(async (args: Args) => {
      const deal = storedDeal();
      if (!deal || deal.id !== args.where.id || deal.archivedAt !== null) return null;
      if (args.where.ownerId !== undefined && deal.ownerId !== args.where.ownerId) return null;
      return deal;
    }),
    // Like Postgres: the write lands only when the stored deal still matches its `where`.
    updateMany: vi.fn(async (args: Args) => {
      if (!state.deal || !matches(state.deal, args.where)) return { count: 0 };
      state.deal = { ...state.deal, ...args.data };
      return { count: 1 };
    }),
  },
  salesStage: {
    findFirst: vi.fn(
      async (args: Args) =>
        STAGES.find(
          (s) =>
            s.id === args.where.id &&
            s.pipelineId === args.where.pipelineId &&
            (args.where.archivedAt === undefined || s.archivedAt === args.where.archivedAt),
        ) ?? null,
    ),
  },
  salesActivity: {
    findMany: vi.fn(async (args: Args) => state.activities.filter((a) => matches(a, args.where))),
    create: vi.fn(async (args: Args) => ({ id: "act-new", ...args.data })),
    updateManyAndReturn: vi.fn(async (args: Args) => {
      const rows = state.activities.filter((a) => matches(a, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return rows.map((row) => selected(row, args.select));
    }),
  },
  salesAuditLog: {
    create: vi.fn(async (args: { data: Row }) => state.audits.push(args.data)),
    // Newest first, like `orderBy: [{ at: "desc" }, { id: "desc" }]`: the rows are kept oldest first.
    findFirst: vi.fn(async (args: Args) => {
      const rows = [...state.history, ...state.audits].filter((row) => matches(row, args.where));
      const newest = rows[rows.length - 1];
      return newest ? selected(newest, args.select) : null;
    }),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const moveRoute = await import("@/app/api/sales/deals/[dealId]/move/route");
const statusRoute = await import("@/app/api/sales/deals/[dealId]/status/route");
const { PermissionError } = await import("@/lib/permissions");
const { endOfDay } = await import("@/lib/utils");

const BASE = "http://localhost/api/sales";
const HEADERS = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
const ctx = (dealId: string) => ({ params: Promise.resolve({ dealId }) });

const move = (body: unknown, dealId = "d1", headers: Record<string, string> = {}) =>
  moveRoute.POST(
    new Request(`${BASE}/deals/${dealId}/move`, { method: "POST", body: JSON.stringify(body), headers: { ...HEADERS, ...headers } }),
    ctx(dealId),
  );
const setStatus = (body: unknown, dealId = "d1") =>
  statusRoute.POST(
    new Request(`${BASE}/deals/${dealId}/status`, { method: "POST", body: JSON.stringify(body), headers: HEADERS }),
    ctx(dealId),
  );

/**
 * An earlier stage_changed history row for d1, as a move writes it: from one
 * stage (entered at `enteredAt`, or with no time when null, as rows written
 * before entry times were kept) to another.
 */
const movedRow = (fromId: string, fromName: string, enteredAt: string | null, toId: string, toName: string): Row => ({
  actorType: "USER",
  actorId: "r",
  entityType: "SalesDeal",
  entityId: "d1",
  action: "stage_changed",
  before: enteredAt === null ? { stageId: fromId, stageName: fromName } : { stageId: fromId, stageName: fromName, stageEnteredAt: enteredAt },
  after: { stageId: toId, stageName: toName },
});

const asActor = (actor: SalesActor) => requireSalesUserMock.mockResolvedValue(actor);
const writes = () => [
  ...db.salesDeal.updateMany.mock.calls,
  ...db.salesActivity.create.mock.calls,
  ...db.salesActivity.updateManyAndReturn.mock.calls,
  ...db.salesAuditLog.create.mock.calls,
];
const actions = () => state.audits.map((row) => row.action);

/**
 * Another request commits `change` to the deal after this one read it and just
 * before this one's guarded write, as a double-click's first request would.
 */
const otherRequestCommitsFirst = (change: Row) => {
  const write = db.salesDeal.updateMany.getMockImplementation()!;
  db.salesDeal.updateMany.mockImplementationOnce(async (args: Args) => {
    state.deal = { ...state.deal, ...change };
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
  state.deal = baseDeal();
  state.activities = [];
  state.history = [];
  state.audits = [];
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

afterEach(() => {
  vi.useRealTimers();
});

const PROPOSAL_RULE = {
  code: "PROPOSAL_NEEDS_VALUE",
  error: "Add the total value and monthly value before moving to Proposal Sent.",
};

describe("POST /api/sales/deals/[dealId]/move: the money rule", () => {
  it("refuses Proposal Sent with both values at $0, and writes nothing", async () => {
    const res = await move({ stageId: "s5", valueCents: 0, mrrCents: 0 });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(PROPOSAL_RULE);
    expect(writes()).toEqual([]);
  });

  it("checks the stored values when a stale screen sends none (Review Focus 1)", async () => {
    state.deal = baseDeal({ valueCents: 1_440_000, mrrCents: 0 });
    const res = await move({ stageId: "s5" });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(PROPOSAL_RULE);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([]);
  });

  it("uses a value sent with the move over the stored one", async () => {
    state.deal = baseDeal({ valueCents: 1_440_000, mrrCents: 120_000 });
    const res = await move({ stageId: "s5", mrrCents: 0 });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(PROPOSAL_RULE);
    expect(writes()).toEqual([]);
  });

  it("saves the values and moves in one transaction, with value_changed then stage_changed", async () => {
    const res = await move({ stageId: "s5", valueCents: 1_440_000, mrrCents: 120_000 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      changed: true,
      deal: { id: "d1", stageId: "s5", stageEnteredAt: now.toISOString(), valueCents: 1_440_000, mrrCents: 120_000 },
      previousStageId: "s4",
      enteredStage: { id: "s5", name: "Proposal Sent", isWon: false, isLost: false, isNoShow: false },
      createdActivityIds: [],
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.salesStage.findFirst.mock.calls[0][0].where).toEqual({ id: "s5", pipelineId: "p1", archivedAt: null });
    expect(db.salesDeal.updateMany).toHaveBeenCalledTimes(1);
    // The write lands only on the deal exactly as it was checked.
    expect(db.salesDeal.updateMany.mock.calls[0][0].where).toEqual({
      id: "d1",
      archivedAt: null,
      ownerId: "r",
      status: "OPEN",
      stageId: "s4",
      valueCents: 0,
      mrrCents: 0,
    });
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({
      stageId: "s5",
      stageEnteredAt: now,
      valueCents: 1_440_000,
      mrrCents: 120_000,
    });

    expect(actions()).toEqual(["value_changed", "stage_changed"]);
    for (const row of state.audits) {
      expect(row).toMatchObject({
        actorType: "USER",
        actorId: "r",
        entityType: "SalesDeal",
        entityId: "d1",
        ipAddress: "203.0.113.9",
      });
    }
    expect(state.audits[0]).toMatchObject({
      before: { valueCents: 0, mrrCents: 0 },
      after: { valueCents: 1_440_000, mrrCents: 120_000 },
    });
    // When the deal had entered the stage it left, so an Undo can put that back (F2).
    expect(state.audits[1].before).toEqual({
      stageId: "s4",
      stageName: "Demo Complete",
      stageEnteredAt: "2026-10-30T14:00:00.000Z",
    });
    expect(state.audits[1].after).toEqual({ stageId: "s5", stageName: "Proposal Sent" });
    expect(db.salesActivity.create).not.toHaveBeenCalled();
    // A plain move never looks back through the history.
    expect(db.salesAuditLog.findFirst).not.toHaveBeenCalled();
  });

  it("moves to Proposal Sent on stored values alone, with no value_changed row", async () => {
    state.deal = baseDeal({ valueCents: 1_440_000, mrrCents: 120_000 });
    const res = await move({ stageId: "s5" });

    expect(res.status).toBe(200);
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({ stageId: "s5", stageEnteredAt: now });
    expect(actions()).toEqual(["stage_changed"]);
  });
});

describe("POST /api/sales/deals/[dealId]/move: refusals", () => {
  it("refuses a stage from another pipeline, and an archived stage", async () => {
    const other = await move({ stageId: "x1" });
    expect(other.status).toBe(400);
    expect(await other.json()).toEqual({ error: "That stage is not part of this deal's pipeline." });

    const archived = await move({ stageId: "s8" });
    expect(archived.status).toBe(400);
    expect(await archived.json()).toEqual({ error: "That stage is not part of this deal's pipeline." });
    expect(writes()).toEqual([]);
  });

  it("refuses to move a won or lost deal (Decision 4)", async () => {
    state.deal = baseDeal({ status: "WON", wonAt: now });
    const won = await move({ stageId: "s5", valueCents: 1_440_000, mrrCents: 120_000 });
    expect(won.status).toBe(409);
    expect(await won.json()).toEqual({ error: "This deal is closed. Reopen it first." });

    state.deal = baseDeal({ status: "LOST", lostAt: now, lostReason: "Price" });
    const lost = await move({ stageId: "s2" });
    expect(lost.status).toBe(409);
    expect(writes()).toEqual([]);
  });

  it("answers 404 for a deal the person may not see and 403 for one they may see but not change", async () => {
    state.deal = baseDeal({ ownerId: "b" });
    const hidden = await move({ stageId: "s2" });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Deal not found." });

    asActor({ ...seesAll, userId: "r" });
    const notYours = await move({ stageId: "s2" });
    expect(notYours.status).toBe(403);
    expect(await notYours.json()).toEqual({ error: "Only the deal owner or an admin can change this deal." });
    expect(writes()).toEqual([]);
  });

  it("refuses someone without Sales access, another site, unknown keys and more than 10 undo ids", async () => {
    requireSalesUserMock.mockRejectedValueOnce(new PermissionError(403, "You don't have access to Sales."));
    const noAccess = await move({ stageId: "s2" });
    expect(noAccess.status).toBe(403);
    expect(await noAccess.json()).toEqual({ error: "You don't have access to Sales." });

    const evil = await move({ stageId: "s2" }, "d1", { host: "app.example.com", origin: "https://evil.example.com" });
    expect(evil.status).toBe(403);
    expect(await evil.json()).toEqual({ error: "Request blocked." });

    const extra = await move({ stageId: "s2", colour: "red" });
    expect(extra.status).toBe(400);

    const tooMany = await move({ stageId: "s2", undoActivityIds: Array.from({ length: 11 }, (_, i) => `a${i}`) });
    expect(tooMany.status).toBe(400);

    const tooBig = await move({ stageId: "s5", valueCents: 1_000_000_001, mrrCents: 1 });
    expect(tooBig.status).toBe(400);
    expect(await tooBig.json()).toEqual({ error: "Values can be up to $10,000,000." });

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});

describe("POST /api/sales/deals/[dealId]/move: doing it twice (Review Focus 4)", () => {
  it("answers unchanged for the stage the deal is already in, with no update and no history", async () => {
    state.deal = baseDeal({ stageId: "s5", valueCents: 1_440_000, mrrCents: 120_000 });
    const res = await move({ stageId: "s5", valueCents: 1_440_000, mrrCents: 120_000 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      changed: false,
      deal: {
        id: "d1",
        stageId: "s5",
        stageEnteredAt: enteredEarlier.toISOString(),
        valueCents: 1_440_000,
        mrrCents: 120_000,
      },
      previousStageId: "s5",
      enteredStage: { id: "s5", name: "Proposal Sent", isWon: false, isLost: false, isNoShow: false },
      createdActivityIds: [],
    });
    expect(writes()).toEqual([]);
  });
});

describe("POST /api/sales/deals/[dealId]/move: two requests at the same time (Review Focus 4)", () => {
  const firstCommit = new Date("2026-11-05T14:59:59Z");

  it("answers a double-click's second Save and move as unchanged, with no second history row", async () => {
    otherRequestCommitsFirst({ stageId: "s5", stageEnteredAt: firstCommit, valueCents: 1_440_000, mrrCents: 120_000 });
    const res = await move({ stageId: "s5", valueCents: 1_440_000, mrrCents: 120_000 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      changed: false,
      deal: { id: "d1", stageId: "s5", stageEnteredAt: firstCommit.toISOString(), valueCents: 1_440_000, mrrCents: 120_000 },
      previousStageId: "s5",
      enteredStage: { id: "s5", name: "Proposal Sent", isWon: false, isLost: false, isNoShow: false },
      createdActivityIds: [],
    });
    // Its own write matched nothing; it then read the deal again, inside the same transaction.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.salesDeal.updateMany).toHaveBeenCalledTimes(1);
    expect(db.salesDeal.findFirst).toHaveBeenCalledTimes(2);
    expect(state.audits).toEqual([]);
  });

  it("adds no second reschedule call when two moves into No Show land together", async () => {
    state.deal = baseDeal({ stageId: "s2" });
    state.activities = [{ id: "call-1", dealId: "d1", createdBy: "rule:no-show", doneAt: null, archivedAt: null }];
    otherRequestCommitsFirst({ stageId: "s3", stageEnteredAt: firstCommit });
    const res = await move({ stageId: "s3" });

    expect(res.status).toBe(200);
    expect((await res.json()).changed).toBe(false);
    expect(db.salesActivity.create).not.toHaveBeenCalled();
    expect(state.audits).toEqual([]);
  });

  it("refuses a move that lost to a Won click as closed, and writes nothing (Decision 4)", async () => {
    otherRequestCommitsFirst({ status: "WON", wonAt: firstCommit });
    const res = await move({ stageId: "s6" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This deal is closed. Reopen it first." });
    expect(state.deal).toMatchObject({ stageId: "s4", status: "WON" });
    expect(state.audits).toEqual([]);
  });

  it("checks the money rule again when the values changed before the write (Review Focus 1)", async () => {
    state.deal = baseDeal({ valueCents: 1_440_000, mrrCents: 120_000 });
    otherRequestCommitsFirst({ mrrCents: 0 });
    const res = await move({ stageId: "s5" });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(PROPOSAL_RULE);
    expect(state.deal).toMatchObject({ stageId: "s4", mrrCents: 0 });
    expect(state.audits).toEqual([]);
  });

  it("answers 409 when the deal keeps changing under it, with no history row", async () => {
    db.salesDeal.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    const res = await move({ stageId: "s3" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This deal just changed. Refresh and try again." });
    expect(db.salesDeal.updateMany).toHaveBeenCalledTimes(2);
    expect(db.salesActivity.create).not.toHaveBeenCalled();
    expect(db.salesActivity.updateManyAndReturn).not.toHaveBeenCalled();
    expect(state.audits).toEqual([]);
  });
});

describe("POST /api/sales/deals/[dealId]/move: the No Show rule", () => {
  it("adds the reschedule call for the deal owner when an admin moves the deal into No Show", async () => {
    asActor(admin);
    state.deal = baseDeal({ stageId: "s2" });
    // A done call and a removed one from an earlier no-show do not count as open.
    state.activities = [
      { id: "old-done", dealId: "d1", createdBy: "rule:no-show", doneAt: now, archivedAt: null },
      { id: "old-gone", dealId: "d1", createdBy: "rule:no-show", doneAt: null, archivedAt: now },
    ];
    const res = await move({ stageId: "s3" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enteredStage).toEqual({ id: "s3", name: "No Show", isWon: false, isLost: false, isNoShow: true });
    expect(body.createdActivityIds).toEqual(["act-new"]);

    expect(db.salesActivity.create).toHaveBeenCalledTimes(1);
    expect(db.salesActivity.create.mock.calls[0][0].data).toEqual({
      type: "CALL",
      subject: "Reschedule the missed demo",
      dueAt: endOfDay("2026-11-05"),
      hasTime: false,
      ownerId: "r",
      createdBy: "rule:no-show",
      dealId: "d1",
      personId: "pe1",
    });

    expect(actions()).toEqual(["stage_changed", "activity_added"]);
    expect(state.audits[0]).toMatchObject({ actorType: "USER", actorId: "z", ipAddress: "203.0.113.9" });
    expect(state.audits[0].after).toEqual({ stageId: "s3", stageName: "No Show" });
    expect(state.audits[1]).toMatchObject({
      actorType: "SYSTEM",
      actorId: null,
      ipAddress: null,
      userAgent: null,
      entityType: "SalesDeal",
      entityId: "d1",
    });
    expect(state.audits[1].after).toEqual({
      activityId: "act-new",
      type: "CALL",
      subject: "Reschedule the missed demo",
      dueAt: endOfDay("2026-11-05").toISOString(),
      hasTime: false,
      createdBy: "rule:no-show",
    });
  });

  it("does not add a second reschedule call while one from the rule is still open", async () => {
    state.deal = baseDeal({ stageId: "s2" });
    state.activities = [{ id: "open-call", dealId: "d1", createdBy: "rule:no-show", doneAt: null, archivedAt: null }];
    const res = await move({ stageId: "s3" });

    expect(res.status).toBe(200);
    expect((await res.json()).createdActivityIds).toEqual([]);
    expect(db.salesActivity.create).not.toHaveBeenCalled();
    expect(actions()).toEqual(["stage_changed"]);
  });

  it("undo removes only this deal's open rule-made calls (Decision 24), and puts back the earlier entry time", async () => {
    state.deal = baseDeal({ stageId: "s3", stageEnteredAt: new Date("2026-11-05T14:58:00Z") });
    state.history = [movedRow("s2", "Appointment Scheduled", "2026-10-30T14:00:00.000Z", "s3", "No Show")];
    state.activities = [
      { id: "a1", dealId: "d1", type: "CALL", subject: "Reschedule the missed demo", createdBy: "rule:no-show", doneAt: null, archivedAt: null },
      { id: "a2", dealId: "d1", type: "CALL", subject: "Follow-up call", createdBy: "r", doneAt: null, archivedAt: null },
      { id: "a3", dealId: "d2", type: "CALL", subject: "Reschedule the missed demo", createdBy: "rule:no-show", doneAt: null, archivedAt: null },
    ];
    const res = await move({ stageId: "s2", undo: true, undoActivityIds: ["a1", "a2", "a3"] });

    expect(res.status).toBe(200);
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({
      stageId: "s2",
      stageEnteredAt: new Date("2026-10-30T14:00:00.000Z"),
    });
    // One guarded write picks and removes the calls, so a call ticked done meanwhile is never removed.
    expect(db.salesActivity.findMany).not.toHaveBeenCalled();
    expect(db.salesActivity.updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(db.salesActivity.updateManyAndReturn.mock.calls[0]).toEqual([
      {
        where: { id: { in: ["a1", "a2", "a3"] }, dealId: "d1", createdBy: "rule:no-show", doneAt: null, archivedAt: null },
        data: { archivedAt: now },
        select: { id: true, type: true, subject: true },
      },
    ]);
    expect(state.activities.map((a) => [a.id, a.archivedAt])).toEqual([
      ["a1", now],
      ["a2", null],
      ["a3", null],
    ]);
    expect(actions()).toEqual(["stage_changed", "activity_removed"]);
    expect(state.audits[0].after).toEqual({
      stageId: "s2",
      stageName: "Appointment Scheduled",
      stageEnteredAt: "2026-10-30T14:00:00.000Z",
      undo: true,
    });
    expect(state.audits[1]).toMatchObject({ actorType: "USER", actorId: "r", ipAddress: "203.0.113.9" });
    expect(state.audits[1].before).toEqual({ activityId: "a1", type: "CALL", subject: "Reschedule the missed demo" });
  });

  it("removes nothing when no undo id names an open rule-made call, a done one included", async () => {
    state.deal = baseDeal({ stageId: "s3" });
    state.activities = [
      { id: "done-call", dealId: "d1", type: "CALL", subject: "Reschedule the missed demo", createdBy: "rule:no-show", doneAt: now, archivedAt: null },
    ];
    const res = await move({ stageId: "s2", undoActivityIds: ["gone", "done-call"] });

    expect(res.status).toBe(200);
    expect(state.activities[0].archivedAt).toBeNull();
    expect(actions()).toEqual(["stage_changed"]);
  });
});

describe("POST /api/sales/deals/[dealId]/move: undo puts back the days in stage (F2)", () => {
  // The deal moved Demo Complete -> Proposal Sent two minutes ago; it had sat in Demo Complete since Oct 30.
  const movedAt = new Date("2026-11-05T14:58:00Z");
  const sentToProposal = () => {
    state.deal = baseDeal({ stageId: "s5", stageEnteredAt: movedAt, valueCents: 1_440_000, mrrCents: 120_000 });
    state.history = [movedRow("s4", "Demo Complete", "2026-10-30T14:00:00.000Z", "s5", "Proposal Sent")];
  };

  it("an undo puts back when the deal entered the stage it returns to, read from the move's history row", async () => {
    sentToProposal();
    const res = await move({ stageId: "s4", undo: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      changed: true,
      deal: { id: "d1", stageId: "s4", stageEnteredAt: "2026-10-30T14:00:00.000Z", valueCents: 1_440_000, mrrCents: 120_000 },
      previousStageId: "s5",
      enteredStage: { id: "s4", name: "Demo Complete", isWon: false, isLost: false, isNoShow: false },
      createdActivityIds: [],
    });
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({
      stageId: "s4",
      stageEnteredAt: new Date("2026-10-30T14:00:00.000Z"),
    });
    // The deal's latest stage change, newest first, through the history index.
    expect(db.salesAuditLog.findFirst.mock.calls[0][0]).toMatchObject({
      where: { entityType: "SalesDeal", entityId: "d1", action: "stage_changed" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
    });
    // The undo is a move of its own in the history, keeping the time it took away,
    // and saying it was an undo and which entry time it put back (M8).
    expect(state.audits.map((row) => [row.action, row.before, row.after])).toEqual([
      [
        "stage_changed",
        { stageId: "s5", stageName: "Proposal Sent", stageEnteredAt: "2026-11-05T14:58:00.000Z" },
        { stageId: "s4", stageName: "Demo Complete", stageEnteredAt: "2026-10-30T14:00:00.000Z", undo: true },
      ],
    ]);
  });

  it("a move back by hand, not an undo, starts the clock again", async () => {
    sentToProposal();
    const res = await move({ stageId: "s4" });

    expect(res.status).toBe(200);
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({ stageId: "s4", stageEnteredAt: now });
    expect(db.salesAuditLog.findFirst).not.toHaveBeenCalled();
    expect(state.audits[0].after).toEqual({ stageId: "s4", stageName: "Demo Complete" });
  });

  it("an undo whose move is no longer the deal's latest stage change is an ordinary move", async () => {
    // Proposal Sent -> Follow-Up since then; the first toast's Undo still asks for Demo Complete.
    state.deal = baseDeal({ stageId: "s6", stageEnteredAt: new Date("2026-11-05T14:59:00Z"), valueCents: 1_440_000, mrrCents: 120_000 });
    state.history = [
      movedRow("s4", "Demo Complete", "2026-10-30T14:00:00.000Z", "s5", "Proposal Sent"),
      movedRow("s5", "Proposal Sent", movedAt.toISOString(), "s6", "Follow-Up"),
    ];
    const res = await move({ stageId: "s4", undo: true });

    expect(res.status).toBe(200);
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({ stageId: "s4", stageEnteredAt: now });
    // The undo flag comes from the screen: the row says undo only when the server put a time back.
    expect(state.audits[0].after).toEqual({ stageId: "s4", stageName: "Demo Complete" });
  });

  it("trusts the row only when it brought the deal into the stage it is in now", async () => {
    // The latest row says Demo Complete -> Proposal Sent, but the deal sits in Follow-Up.
    state.deal = baseDeal({ stageId: "s6", stageEnteredAt: movedAt });
    state.history = [movedRow("s4", "Demo Complete", "2026-10-30T14:00:00.000Z", "s5", "Proposal Sent")];
    const res = await move({ stageId: "s4", undo: true });

    expect(res.status).toBe(200);
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({ stageId: "s4", stageEnteredAt: now });
  });

  // One case per row, each on a fresh fake database (beforeEach), so every case
  // reads its own seeded row and the time guard alone decides the result (M6).
  it.each([
    ["no time (written before times were kept)", null],
    ["a time that is not a date", "not a date"],
    ["a time after now", "2026-11-06T09:00:00.000Z"],
  ])("an undo whose move row holds %s starts the clock again", async (_name, kept) => {
    sentToProposal();
    const seeded = movedRow("s4", "Demo Complete", kept, "s5", "Proposal Sent");
    state.history = [seeded];
    const res = await move({ stageId: "s4", undo: true });

    expect(res.status).toBe(200);
    // The row the undo read is the seeded move, which does match the deal: only its time is unusable.
    expect(db.salesAuditLog.findFirst).toHaveBeenCalledTimes(1);
    expect(await db.salesAuditLog.findFirst.mock.results[0].value).toEqual({ before: seeded.before, after: seeded.after });
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({ stageId: "s4", stageEnteredAt: now });
    // Nothing was put back, so the history row is an ordinary move.
    expect(state.audits[0].after).toEqual({ stageId: "s4", stageName: "Demo Complete" });
  });

  it("refuses an undo flag that is not true", async () => {
    const res = await move({ stageId: "s4", undo: "yes" });
    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/sales/deals/[dealId]/status", () => {
  it("asks for a reason when marking lost, and caps the comment at 1,000 characters", async () => {
    const noReason = await setStatus({ status: "LOST" });
    expect(noReason.status).toBe(400);
    expect(await noReason.json()).toEqual({ error: "Pick a reason." });

    const madeUp = await setStatus({ status: "LOST", lostReason: "Bad vibes" });
    expect(madeUp.status).toBe(400);
    expect(await madeUp.json()).toEqual({ error: "Pick a reason." });

    const tooLong = await setStatus({ status: "LOST", lostReason: "Price", lostComment: "x".repeat(1_001) });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "Keep the comment under 1,000 characters." });

    const unknown = await setStatus({ status: "MAYBE" });
    expect(unknown.status).toBe(400);

    const extra = await setStatus({ status: "WON", lostReason: "Price" });
    expect(extra.status).toBe(400);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("marks a deal lost with its reason and comment", async () => {
    const res = await setStatus({ status: "LOST", lostReason: "Price", lostComment: "  Went with a cheaper printer  " });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      changed: true,
      deal: { id: "d1", status: "LOST", wonAt: null, lostAt: now.toISOString(), lostReason: "Price" },
    });
    // The write lands only on the deal exactly as it was checked.
    expect(db.salesDeal.updateMany.mock.calls[0][0].where).toEqual({ id: "d1", archivedAt: null, ownerId: "r", status: "OPEN" });
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({
      status: "LOST",
      lostAt: now,
      lostReason: "Price",
      lostComment: "Went with a cheaper printer",
      wonAt: null,
    });
    expect(actions()).toEqual(["status_changed"]);
    expect(state.audits[0]).toMatchObject({ actorType: "USER", actorId: "r", ipAddress: "203.0.113.9" });
    expect(state.audits[0].before).toEqual({ status: "OPEN" });
    expect(state.audits[0].after).toEqual({ status: "LOST", lostReason: "Price", lostComment: "Went with a cheaper printer" });
  });

  it("keeps a blank comment out of the deal and its history", async () => {
    const res = await setStatus({ status: "LOST", lostReason: "No response", lostComment: "   " });

    expect(res.status).toBe(200);
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({
      status: "LOST",
      lostAt: now,
      lostReason: "No response",
      lostComment: null,
      wonAt: null,
    });
    expect(state.audits[0].after).toEqual({ status: "LOST", lostReason: "No response" });
  });

  it("marks a deal won, and a second Won changes nothing", async () => {
    const res = await setStatus({ status: "WON" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      changed: true,
      deal: { id: "d1", status: "WON", wonAt: now.toISOString(), lostAt: null, lostReason: null },
    });
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({
      status: "WON",
      wonAt: now,
      lostAt: null,
      lostReason: null,
      lostComment: null,
    });
    expect(state.audits.map((row) => [row.action, row.before, row.after])).toEqual([
      ["status_changed", { status: "OPEN" }, { status: "WON" }],
    ]);

    db.salesDeal.updateMany.mockClear();
    state.audits = [];
    state.deal = baseDeal({ status: "WON", wonAt: now });
    const again = await setStatus({ status: "WON" });

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({
      ok: true,
      changed: false,
      deal: { id: "d1", status: "WON", wonAt: now.toISOString(), lostAt: null, lostReason: null },
    });
    expect(db.salesDeal.updateMany).not.toHaveBeenCalled();
    expect(state.audits).toEqual([]);
  });

  it("reopens a lost deal and clears its lost and won fields", async () => {
    state.deal = baseDeal({ status: "LOST", lostAt: enteredEarlier, lostReason: "Price", lostComment: "Too dear" });
    const res = await setStatus({ status: "OPEN" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      changed: true,
      deal: { id: "d1", status: "OPEN", wonAt: null, lostAt: null, lostReason: null },
    });
    expect(db.salesDeal.updateMany.mock.calls[0][0].data).toEqual({
      status: "OPEN",
      wonAt: null,
      lostAt: null,
      lostReason: null,
      lostComment: null,
    });
    expect(state.audits.map((row) => [row.action, row.before, row.after])).toEqual([
      ["status_changed", { status: "LOST" }, { status: "OPEN" }],
    ]);
  });

  it("answers 404 for a deal the person may not see and 403 for one they may see but not change", async () => {
    state.deal = baseDeal({ ownerId: "b" });
    const hidden = await setStatus({ status: "WON" });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Deal not found." });

    asActor({ ...seesAll, userId: "r" });
    const notYours = await setStatus({ status: "WON" });
    expect(notYours.status).toBe(403);
    expect(writes()).toEqual([]);
  });
});

describe("POST /api/sales/deals/[dealId]/status: two requests at the same time (Review Focus 4)", () => {
  it("answers a double-click's second Won as unchanged, with no second history row", async () => {
    otherRequestCommitsFirst({ status: "WON", wonAt: now });
    const res = await setStatus({ status: "WON" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      changed: false,
      deal: { id: "d1", status: "WON", wonAt: now.toISOString(), lostAt: null, lostReason: null },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.salesDeal.updateMany).toHaveBeenCalledTimes(1);
    expect(state.audits).toEqual([]);
  });

  it("answers 409 when the deal keeps changing under it, with no history row", async () => {
    db.salesDeal.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    const res = await setStatus({ status: "LOST", lostReason: "Price" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This deal just changed. Refresh and try again." });
    expect(db.salesDeal.updateMany).toHaveBeenCalledTimes(2);
    expect(state.audits).toEqual([]);
  });
});
