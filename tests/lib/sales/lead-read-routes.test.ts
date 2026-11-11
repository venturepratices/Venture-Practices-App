import { beforeEach, describe, expect, it, vi } from "vitest";

// The read routes behind the lead panel and its History. Run directly with a
// fake database and a fake Sales gate; nothing here reaches a real database or
// a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };

const panelLead = {
  id: "l1",
  title: "Oak Creek Dental",
  status: "OPEN",
  source: "Added by hand",
  createdAt: new Date("2026-11-03T14:00:00.000Z"),
  ownerId: "r",
  convertedDealId: null,
  owner: { id: "r", name: "Rachel P." },
  organization: { id: "o1", name: "Oak Creek Dental" },
  person: null,
};
const state = { lead: null as Row | null };

const db = {
  salesLead: { findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => state.lead) },
  salesDeal: { findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => null) },
  salesActivity: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  salesCustomField: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  salesCustomFieldValue: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  salesAuditLog: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  salesNote: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  teamMember: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => [{ id: "r", name: "Rachel P." }]) },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const leadRoute = await import("@/app/api/sales/leads/[leadId]/route");
const timelineRoute = await import("@/app/api/sales/leads/[leadId]/timeline/route");
const { PermissionError } = await import("@/lib/permissions");

const BASE = "http://localhost/api/sales";
const ctx = (leadId: string) => ({ params: Promise.resolve({ leadId }) });
const allQueries = () => Object.values(db).flatMap((delegate) => Object.values(delegate).flatMap((fn) => fn.mock.calls));

beforeEach(() => {
  for (const delegate of Object.values(db)) for (const fn of Object.values(delegate)) fn.mockClear();
  state.lead = null;
  requireSalesUserMock.mockReset().mockResolvedValue({ userId: "r", isAdmin: false, seesAllDeals: false, via: "user" });
});

const noAccess = () => requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));

describe("GET /api/sales/leads/[leadId]", () => {
  const get = () => leadRoute.GET(new Request(`${BASE}/leads/l1`), ctx("l1"));

  it("refuses someone without Sales access and reads nothing", async () => {
    noAccess();
    const res = await get();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have access to Sales." });
    expect(allQueries()).toEqual([]);
  });

  it("answers 404 for a lead the person may not see, or a deleted one", async () => {
    const res = await get();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Lead not found." });
    expect(db.salesLead.findFirst.mock.calls[0][0].where).toEqual({ id: "l1", archivedAt: null, ownerId: "r" });
  });

  it("returns the panel", async () => {
    state.lead = panelLead;
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lead: {
        id: "l1",
        title: "Oak Creek Dental",
        status: "OPEN",
        source: "Added by hand",
        createdAt: "2026-11-03T14:00:00.000Z",
        owner: { id: "r", name: "Rachel P." },
        organization: { id: "o1", name: "Oak Creek Dental" },
        person: null,
      },
      convertedDeal: null,
      openActivities: [],
      fields: [],
      members: [{ id: "r", name: "Rachel P." }],
      canEdit: true,
      canRestore: false,
    });
  });
});

describe("GET /api/sales/leads/[leadId]/timeline", () => {
  const get = (search = "") => timelineRoute.GET(new Request(`${BASE}/leads/l1/timeline${search}`), ctx("l1"));

  it("refuses someone without Sales access and reads nothing", async () => {
    noAccess();
    expect((await get()).status).toBe(403);
    expect(allQueries()).toEqual([]);
  });

  it("answers 404 for a lead the person may not see", async () => {
    const res = await get();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Lead not found." });
    expect(db.salesAuditLog.findMany).not.toHaveBeenCalled();
  });

  it("returns the first page", async () => {
    state.lead = { id: "l1" };
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [], nextCursor: null });
    expect(db.salesAuditLog.findMany.mock.calls[0][0].where).toEqual({ entityType: "SalesLead", entityId: "l1" });
  });

  it("continues from a cursor", async () => {
    state.lead = { id: "l1" };
    await get("?at=2026-11-04T12:00:00.000Z&id=log9");

    const cursorAt = new Date("2026-11-04T12:00:00.000Z");
    expect(db.salesAuditLog.findMany.mock.calls[0][0].where).toEqual({
      entityType: "SalesLead",
      entityId: "l1",
      OR: [{ at: { lt: cursorAt } }, { at: cursorAt, id: { lt: "log9" } }],
    });
  });

  it("ignores a cursor it cannot read and returns the first page, not a 500", async () => {
    state.lead = { id: "l1" };
    for (const search of ["?at=yesterday&id=log9", "?at=2026-11-04T12:00:00.000Z", `?at=2026-11-04T12:00:00.000Z&id=${"x".repeat(65)}`]) {
      db.salesAuditLog.findMany.mockClear();
      const res = await get(search);

      expect(res.status, search).toBe(200);
      expect(db.salesAuditLog.findMany.mock.calls[0][0].where, search).toEqual({ entityType: "SalesLead", entityId: "l1" });
    }
  });
});
