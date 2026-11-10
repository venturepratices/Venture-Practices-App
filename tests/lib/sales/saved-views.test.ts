import { beforeEach, describe, expect, it, vi } from "vitest";

// Saved Deals views (Decision 29): the rules on a person's list of named views,
// turning one back into a board query, the toolbar's add and remove helpers,
// and the per-person store and its PUT route. A preference, not Sales data, so
// nothing here writes a history row. Run with a fake database and a fake Sales
// gate; nothing reaches a real database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };

const db = {
  teamMember: {
    findUnique: vi.fn<(args: Args) => Promise<Row | null>>(async () => null),
    update: vi.fn<(args: Args) => Promise<unknown>>(async () => ({ id: "r" })),
  },
  salesPipeline: {
    findMany: vi.fn<(args: Args) => Promise<Row[]>>(async () => []),
  },
  salesAuditLog: {
    create: vi.fn<(args: Args) => Promise<unknown>>(async () => ({})),
    createMany: vi.fn<(args: Args) => Promise<unknown>>(async () => ({ count: 0 })),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { savedViewsSchema, savedViewToQuery } = await import("@/lib/sales/board-query");
const { addSavedView, removeSavedView } = await import("@/lib/sales/board-client");
const { loadSavedViews, loadSavedViewItems, saveSavedViews } = await import("@/lib/sales/view-preference");
const viewsRoute = await import("@/app/api/sales/views/route");
const { PermissionError } = await import("@/lib/permissions");

type BoardQuery = import("@/lib/sales/board-query").BoardQuery;
type SavedBoardView = import("@/lib/sales/board-query").SavedBoardView;

const LIMIT = "You can keep up to 20 views. Remove one first.";
const NO_NAME = "Give the view a name.";
const TOO_LONG = "Keep the name under 40 characters.";
const TAKEN = "You already have a view with that name.";

const view = (name: string, extra: Partial<SavedBoardView> = {}): SavedBoardView => ({
  name,
  pipeline: "direct-mail",
  view: "board",
  scope: "everyone",
  status: "open",
  next: "any",
  stage: null,
  q: "",
  ...extra,
});
const views = (count: number) => Array.from({ length: count }, (_, i) => view(`View ${i + 1}`));

/** The message a list of views is refused with (what the route answers), or null when it is accepted. */
function refusal(input: unknown): string | null {
  const parsed = savedViewsSchema.safeParse(input);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "");
}

const PROPOSALS_QUERY: BoardQuery = {
  pipeline: "direct-mail",
  view: "list",
  scope: "mine",
  status: "open",
  next: "any",
  stage: "proposal-sent",
  q: "",
  cursor: "d50",
};
const PROPOSALS_VIEW: SavedBoardView = {
  name: "Proposals out",
  pipeline: "direct-mail",
  view: "list",
  scope: "mine",
  status: "open",
  next: "any",
  stage: "proposal-sent",
  q: "",
};

const put = (body: unknown, headers: Record<string, string> = {}) =>
  viewsRoute.PUT(
    new Request("http://localhost/api/sales/views", {
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", host: "localhost", ...headers },
    }),
  );

beforeEach(() => {
  for (const delegate of [db.teamMember, db.salesPipeline, db.salesAuditLog])
    for (const fn of Object.values(delegate)) fn.mockClear();
  db.$transaction.mockClear();
  db.teamMember.findUnique.mockReset().mockResolvedValue(null);
  db.salesPipeline.findMany.mockReset().mockResolvedValue([]);
  requireSalesUserMock.mockReset().mockResolvedValue({ userId: "r", isAdmin: false, seesAllDeals: false, via: "user" });
});

describe("savedViewsSchema", () => {
  it("checks view names and the limit", () => {
    expect(refusal(views(20))).toBeNull();
    expect(refusal(views(21))).toBe(LIMIT);
    expect(refusal([view("  ")])).toBe(NO_NAME);
    expect(refusal([view("")])).toBe(NO_NAME);
    expect(refusal([view("x".repeat(40))])).toBeNull();
    expect(refusal([view("x".repeat(41))])).toBe(TOO_LONG);
    expect(refusal([view("Proposals out"), view("proposals OUT")])).toBe(TAKEN);
    // Names are compared after trimming, as they are stored.
    expect(refusal([view("Proposals out"), view("  Proposals out ")])).toBe(TAKEN);
  });

  it("names the limit before anything else is wrong with the views", () => {
    expect(refusal([...views(20), view("  ")])).toBe(LIMIT);
    expect(refusal([...views(20), view("View 1")])).toBe(LIMIT);
  });

  it("stores a trimmed name", () => {
    expect(savedViewsSchema.parse([view("  Proposals out ")])).toEqual([view("Proposals out")]);
  });

  it("accepts only the board's own values, and no other keys", () => {
    expect(refusal([view("A", { pipeline: null, stage: null })])).toBeNull();
    expect(refusal([view("A", { pipeline: "x".repeat(64), stage: "s".repeat(64), q: "q".repeat(100) })])).toBeNull();
    for (const extra of [
      { pipeline: "" },
      { pipeline: "x".repeat(65) },
      { stage: "" },
      { stage: "s".repeat(65) },
      { q: "q".repeat(101) },
      { view: "grid" },
      { scope: "team" },
      { status: "deleted" },
      { next: "later" },
    ]) {
      expect(refusal([{ ...view("A"), ...extra }]), JSON.stringify(extra)).not.toBeNull();
    }
    expect(refusal([{ ...view("A"), cursor: "d50" }])).not.toBeNull();
    expect(refusal([{ ...view("A"), extra: 1 }])).not.toBeNull();
    expect(refusal({ views: 3 })).not.toBeNull();
  });
});

describe("savedViewToQuery", () => {
  it("turns a saved view back into a board query", () => {
    expect(
      savedViewToQuery({
        name: "Proposals out",
        pipeline: "direct-mail",
        view: "list",
        scope: "mine",
        status: "open",
        next: "any",
        stage: "proposal-sent",
        q: "",
      }),
    ).toEqual({
      pipeline: "direct-mail",
      view: "list",
      scope: "mine",
      status: "open",
      next: "any",
      stage: "proposal-sent",
      q: "",
      cursor: null,
    });
  });
});

describe("addSavedView and removeSavedView", () => {
  it("adds and removes views", () => {
    const added = addSavedView([], "Proposals out", PROPOSALS_QUERY);
    // The view keeps everything the board shows, but never the page cursor.
    expect(added).toEqual({ ok: true, views: [PROPOSALS_VIEW] });

    const kept = [view("Overdue calls", { next: "overdue" })];
    const second = addSavedView(kept, "  Proposals out ", PROPOSALS_QUERY);
    expect(second).toEqual({ ok: true, views: [kept[0], PROPOSALS_VIEW] });
    expect(kept).toHaveLength(1);

    expect(addSavedView([PROPOSALS_VIEW], "proposals OUT", PROPOSALS_QUERY)).toEqual({ ok: false, error: TAKEN });
    expect(addSavedView(views(20), "One more", PROPOSALS_QUERY)).toEqual({ ok: false, error: LIMIT });
    expect(addSavedView([], "   ", PROPOSALS_QUERY)).toEqual({ ok: false, error: NO_NAME });
    expect(addSavedView([], "x".repeat(41), PROPOSALS_QUERY)).toEqual({ ok: false, error: TOO_LONG });

    const list = [view("Overdue calls"), PROPOSALS_VIEW, view("Won this year", { status: "won" })];
    expect(removeSavedView(list, "Proposals out")).toEqual([view("Overdue calls"), view("Won this year", { status: "won" })]);
    expect(removeSavedView(list, "Not there")).toEqual(list);
    expect(list).toHaveLength(3);
  });
});

describe("the per-person store", () => {
  it("loads and saves views per person, with no history", async () => {
    db.teamMember.findUnique.mockResolvedValueOnce({ salesSavedViews: { views: 3 } });
    expect(await loadSavedViews("r")).toEqual([]);
    expect(db.teamMember.findUnique.mock.calls[0][0]).toEqual({ where: { id: "r" }, select: { salesSavedViews: true } });

    db.teamMember.findUnique.mockResolvedValueOnce({ salesSavedViews: null });
    expect(await loadSavedViews("r")).toEqual([]);
    db.teamMember.findUnique.mockResolvedValueOnce(null);
    expect(await loadSavedViews("gone")).toEqual([]);
    db.teamMember.findUnique.mockResolvedValueOnce({ salesSavedViews: [PROPOSALS_VIEW, { name: 3 }] });
    expect(await loadSavedViews("r")).toEqual([]);

    const stored = [PROPOSALS_VIEW, view("Overdue calls", { pipeline: null, next: "overdue" })];
    db.teamMember.findUnique.mockResolvedValueOnce({ salesSavedViews: stored });
    expect(await loadSavedViews("r")).toEqual(stored);

    await saveSavedViews("r", stored);
    expect(db.teamMember.update).toHaveBeenCalledTimes(1);
    expect(db.teamMember.update.mock.calls[0][0]).toEqual({
      where: { id: "r" },
      data: { salesSavedViews: stored },
      select: { id: true },
    });
    expect(db.salesAuditLog.create).not.toHaveBeenCalled();
    expect(db.salesAuditLog.createMany).not.toHaveBeenCalled();
  });
});

describe("loadSavedViewItems", () => {
  const livePipelines = [
    { key: "direct-mail", name: "Direct Mail", stages: [{ key: "proposal-sent", name: "Proposal Sent" }] },
    { key: "consulting", name: "Consulting", stages: [] },
  ];

  it("lists saved views with summaries", async () => {
    const overdue = view("Overdue calls", { pipeline: "direct-mail", stage: null, next: "overdue" });
    db.teamMember.findUnique.mockResolvedValueOnce({ salesSavedViews: [PROPOSALS_VIEW, overdue] });
    db.salesPipeline.findMany.mockResolvedValueOnce(livePipelines);

    const items = await loadSavedViewItems("r");
    expect(items).toEqual([
      { view: PROPOSALS_VIEW, summary: "Direct Mail · List · Just me · Proposal Sent" },
      { view: overdue, summary: "Direct Mail · Board · Everyone · Overdue" },
    ]);

    expect(db.salesPipeline.findMany).toHaveBeenCalledWith({
      where: { archivedAt: null, kind: { in: ["SALES", "CONSULTING"] } },
      orderBy: { position: "asc" },
      select: { key: true, name: true, stages: { where: { archivedAt: null }, select: { key: true, name: true } } },
    });
  });

  it("drops the pipeline and stage bits when the saved view's pipeline is gone", async () => {
    const gone = view("Old", { pipeline: "archived-pipeline", stage: "proposal-sent" });
    db.teamMember.findUnique.mockResolvedValueOnce({ salesSavedViews: [gone] });
    db.salesPipeline.findMany.mockResolvedValueOnce(livePipelines);

    const items = await loadSavedViewItems("r");
    expect(items).toEqual([{ view: gone, summary: "Board · Everyone" }]);
  });
});

describe("PUT /api/sales/views", () => {
  it("saves the signed-in person's views and answers with them", async () => {
    const res = await put({ views: [{ ...PROPOSALS_VIEW, name: " Proposals out " }] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ views: [PROPOSALS_VIEW] });
    expect(db.teamMember.update).toHaveBeenCalledTimes(1);
    expect(db.teamMember.update.mock.calls[0][0]).toEqual({
      where: { id: "r" },
      data: { salesSavedViews: [PROPOSALS_VIEW] },
      select: { id: true },
    });
    expect(db.salesAuditLog.create).not.toHaveBeenCalled();
    expect(db.salesAuditLog.createMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("saves an empty list (the last view removed)", async () => {
    const res = await put({ views: [] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ views: [] });
    expect(db.teamMember.update.mock.calls[0][0]).toMatchObject({ data: { salesSavedViews: [] } });
  });

  it("refuses 21 views, a taken name, a bad body or extra keys, and saves nothing", async () => {
    const cases: [unknown, string | null][] = [
      [{ views: views(21) }, LIMIT],
      [{ views: [PROPOSALS_VIEW, { ...PROPOSALS_VIEW, name: "PROPOSALS OUT" }] }, TAKEN],
      [{ views: [{ ...PROPOSALS_VIEW, name: "" }] }, NO_NAME],
      [{ views: [PROPOSALS_VIEW], extra: 1 }, null],
      [{ views: [{ ...PROPOSALS_VIEW, cursor: "d50" }] }, null],
      [{}, null],
      ["{not json", "Invalid input."],
    ];
    for (const [body, message] of cases) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const answer = (await res.json()) as { error: unknown };
      if (message) expect(answer).toEqual({ error: message });
      else expect(typeof answer.error).toBe("string");
    }
    expect(db.teamMember.update).not.toHaveBeenCalled();
    expect(db.salesAuditLog.create).not.toHaveBeenCalled();
  });

  it("blocks a request from another site and saves nothing", async () => {
    const res = await put({ views: [PROPOSALS_VIEW] }, { origin: "https://evil.example" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(db.teamMember.update).not.toHaveBeenCalled();
    expect(db.salesAuditLog.create).not.toHaveBeenCalled();
  });

  it("refuses someone without Sales access before reading the body", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await put({ views: [PROPOSALS_VIEW] });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have access to Sales." });
    expect(db.teamMember.update).not.toHaveBeenCalled();
  });
});
