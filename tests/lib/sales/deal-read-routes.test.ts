import { beforeEach, describe, expect, it, vi } from "vitest";

// The read routes behind the Deals list's "Show more", the deal panel and its
// History, plus the remembered-view save. Run directly with a fake database and
// a fake Sales gate; nothing here reaches a real database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };

const PIPELINE = { id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES" };
const state = { pipelines: [PIPELINE] as Row[], deal: null as Row | null, listRows: [] as Row[] };

const listDeal = (i: number) => ({
  id: `d${i}`,
  title: `Deal ${i}`,
  valueCents: 0,
  mrrCents: 0,
  stageId: "s1",
  status: "OPEN",
  stageEnteredAt: new Date("2026-11-01T15:00:00Z"),
  ownerId: "r",
  person: null,
  organization: null,
  stage: { name: "Lead In" },
});
const panelDeal = {
  id: "d1",
  title: "Oak Creek Dental",
  status: "OPEN",
  valueCents: 0,
  mrrCents: 0,
  stageId: "s1",
  stageEnteredAt: new Date("2026-11-01T15:00:00Z"),
  lostReason: null,
  lostComment: null,
  source: null,
  ownerId: "r",
  owner: { id: "r", name: "Rachel P." },
  organization: null,
  person: null,
  pipeline: PIPELINE,
};

const db = {
  salesPipeline: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.pipelines) },
  salesStage: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  salesDeal: {
    findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.listRows),
    findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => state.deal),
  },
  salesActivity: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  salesCustomField: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  salesCustomFieldValue: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  salesAuditLog: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  salesNote: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  teamMember: {
    findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => [{ id: "r", name: "Rachel P." }]),
    update: vi.fn<(args: Args) => Promise<unknown>>(async () => ({ id: "r" })),
    findUnique: vi.fn<(args: Args) => Promise<Row | null>>(async () => ({
      salesDefaultView: { pipeline: "direct-mail", view: "list", scope: "mine" },
    })),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const dealsRoute = await import("@/app/api/sales/deals/route");
const dealRoute = await import("@/app/api/sales/deals/[dealId]/route");
const timelineRoute = await import("@/app/api/sales/deals/[dealId]/timeline/route");
const viewRoute = await import("@/app/api/sales/view/route");
const { PermissionError } = await import("@/lib/permissions");
const { loadDefaultView } = await import("@/lib/sales/view-preference");

const BASE = "http://localhost/api/sales";
const ctx = (dealId: string) => ({ params: Promise.resolve({ dealId }) });
const put = (body: unknown) =>
  viewRoute.PUT(
    new Request(`${BASE}/view`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  );
const allQueries = () => [
  ...db.salesPipeline.findMany.mock.calls,
  ...db.salesDeal.findMany.mock.calls,
  ...db.salesDeal.findFirst.mock.calls,
  ...db.salesAuditLog.findMany.mock.calls,
];

beforeEach(() => {
  for (const delegate of Object.values(db)) for (const fn of Object.values(delegate)) fn.mockClear();
  state.pipelines = [PIPELINE];
  state.deal = null;
  state.listRows = [];
  requireSalesUserMock.mockReset().mockResolvedValue({ userId: "r", isAdmin: false, seesAllDeals: false, via: "user" });
});

const noAccess = () => requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));

describe("GET /api/sales/deals/[dealId]", () => {
  it("refuses someone without Sales access and reads nothing", async () => {
    noAccess();
    const res = await dealRoute.GET(new Request(`${BASE}/deals/d1`), ctx("d1"));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have access to Sales." });
    expect(allQueries()).toEqual([]);
  });

  it("answers 404 for a deal the person may not see", async () => {
    const res = await dealRoute.GET(new Request(`${BASE}/deals/d1`), ctx("d1"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Deal not found." });
    expect(db.salesDeal.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", archivedAt: null, ownerId: "r" });
  });

  it("returns the panel", async () => {
    state.deal = panelDeal;
    const res = await dealRoute.GET(new Request(`${BASE}/deals/d1`), ctx("d1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      deal: { id: "d1", title: "Oak Creek Dental", stageEnteredAt: "2026-11-01T15:00:00.000Z", owner: { id: "r", name: "Rachel P." } },
      pipeline: PIPELINE,
      canEdit: true,
      territoryHold: null,
      members: [{ id: "r", name: "Rachel P." }],
    });
  });
});

describe("GET /api/sales/deals/[dealId]/timeline", () => {
  const get = (search = "") => timelineRoute.GET(new Request(`${BASE}/deals/d1/timeline${search}`), ctx("d1"));

  it("refuses someone without Sales access", async () => {
    noAccess();
    expect((await get()).status).toBe(403);
    expect(allQueries()).toEqual([]);
  });

  it("answers 404 for a deal the person may not see", async () => {
    const res = await get();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Deal not found." });
    expect(db.salesAuditLog.findMany).not.toHaveBeenCalled();
  });

  it("returns the first page", async () => {
    state.deal = { id: "d1", ownerId: "r" };
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [], nextCursor: null });
  });

  it("continues from a cursor", async () => {
    state.deal = { id: "d1", ownerId: "r" };
    await get("?at=2026-11-04T12:00:00.000Z&id=log9");

    expect(db.salesAuditLog.findMany.mock.calls[0][0].where).toHaveProperty("OR");
  });

  it("ignores a cursor it cannot read and returns the first page", async () => {
    state.deal = { id: "d1", ownerId: "r" };
    for (const search of ["?at=yesterday&id=log9", "?at=2026-11-04T12:00:00.000Z", `?at=2026-11-04T12:00:00.000Z&id=${"x".repeat(65)}`]) {
      db.salesAuditLog.findMany.mockClear();
      const res = await get(search);

      expect(res.status, search).toBe(200);
      expect(db.salesAuditLog.findMany.mock.calls[0][0].where, search).not.toHaveProperty("OR");
    }
  });
});

describe("PUT /api/sales/view", () => {
  it("saves the person's default view", async () => {
    const res = await put({ pipeline: "direct-mail", view: "list", scope: "mine" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.teamMember.update).toHaveBeenCalledTimes(1);
    expect(db.teamMember.update.mock.calls[0][0]).toMatchObject({
      where: { id: "r" },
      data: { salesDefaultView: { pipeline: "direct-mail", view: "list", scope: "mine" } },
    });
  });

  it("refuses a view it does not know, or extra keys, and saves nothing", async () => {
    for (const body of [{ view: "grid" }, { pipeline: "x", view: "board", scope: "mine", extra: 1 }]) {
      const res = await put(body);

      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
    expect(db.teamMember.update).not.toHaveBeenCalled();
  });

  it("refuses someone without Sales access", async () => {
    noAccess();
    expect((await put({ pipeline: null, view: "board", scope: "everyone" })).status).toBe(403);
    expect(db.teamMember.update).not.toHaveBeenCalled();
  });
});

describe("loadDefaultView", () => {
  it("reads the person's stored view as raw JSON", async () => {
    expect(await loadDefaultView("r")).toEqual({ pipeline: "direct-mail", view: "list", scope: "mine" });
    expect(db.teamMember.findUnique.mock.calls[0][0]).toEqual({ where: { id: "r" }, select: { salesDefaultView: true } });
  });

  it("is null for someone who never saved one, or who is gone", async () => {
    db.teamMember.findUnique.mockResolvedValueOnce({ salesDefaultView: null });
    expect(await loadDefaultView("r")).toBeNull();
    db.teamMember.findUnique.mockResolvedValueOnce(null);
    expect(await loadDefaultView("gone")).toBeNull();
  });
});

describe("GET /api/sales/deals (list pages)", () => {
  const get = (search: string) => dealsRoute.GET(new Request(`${BASE}/deals${search}`));

  it("refuses someone without Sales access and reads nothing", async () => {
    noAccess();
    const res = await get("?pipeline=direct-mail&view=list");

    expect(res.status).toBe(403);
    expect(allQueries()).toEqual([]);
  });

  it("returns the first page and where the next one starts", async () => {
    state.listRows = Array.from({ length: 51 }, (_, i) => listDeal(i + 1));
    const res = await get("?pipeline=direct-mail&view=list");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(50);
    expect(body.rows[0]).toMatchObject({ id: "d1", stageName: "Lead In", stageEnteredAt: "2026-11-01T15:00:00.000Z" });
    expect(body.nextCursor).toBe("d50");
  });

  it("passes the cursor to the query", async () => {
    await get("?cursor=d50");

    expect(db.salesDeal.findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: "d50" }, skip: 1, take: 51 });
  });

  it("applies the filters in the URL", async () => {
    await get("?scope=mine&status=won&q=oak");

    expect(db.salesDeal.findMany.mock.calls[0][0].where).toMatchObject({ status: "WON", ownerId: "r", OR: expect.any(Array) });
  });

  it("ignores a cursor it cannot read and returns the first page", async () => {
    state.listRows = [listDeal(1)];
    const res = await get(`?cursor=${"x".repeat(65)}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [expect.objectContaining({ id: "d1" })], nextCursor: null });
    const args = db.salesDeal.findMany.mock.calls[0][0];
    expect(args).not.toHaveProperty("cursor");
    expect(args).not.toHaveProperty("skip");
  });

  it("returns an empty page when there is no pipeline", async () => {
    state.pipelines = [];
    const res = await get("");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], nextCursor: null });
  });
});
