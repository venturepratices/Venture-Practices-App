import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin Sales settings route, run directly with a fake database and a fake
// admin check. Nothing here reaches a real database or a real session.

const requireAdminMock = vi.fn();
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, requireAdmin: () => requireAdminMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
const db = { settings: null as Row | null, audits: [] as Row[], salesMemberIds: new Set<string>() };

const memberFindMany = vi.fn(async (args: { where: { id: { in: string[] } } }) =>
  args.where.id.in.filter((id) => db.salesMemberIds.has(id)).map((id) => ({ id })),
);

// Like Prisma: undefined fields are left alone, and only the selected fields come back
// (so the internal cursor never leaves unless a route asks for it).
const defined = (row: Row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
const selected = (row: Row | null, select: Row) =>
  row ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : null;

const settingsDelegate = {
  findUnique: async (args: { where: { id: string }; select: Row }) =>
    args.where.id === "singleton" ? selected(db.settings, args.select) : null,
  upsert: vi.fn(async (args: { where: { id: string }; create: Row; update: Row; select: Row }) => {
    if (db.settings) {
      Object.assign(db.settings, defined(args.update));
    } else {
      db.settings = { rrCursor: 0, leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: [], singleAssigneeId: null, ...defined(args.create) };
    }
    return selected(db.settings, args.select);
  }),
};
const tx = {
  salesSettings: settingsDelegate,
  salesAuditLog: { create: async (args: { data: Row }) => db.audits.push(args.data) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesSettings: settingsDelegate,
    teamMember: { findMany: (...args: unknown[]) => memberFindMany(...(args as [never])) },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}));

const route = await import("@/app/api/sales/settings/route");
const { PermissionError } = await import("@/lib/permissions");
const { SALES_MEMBER_WHERE } = await import("@/lib/sales/access");

const patch = (body: unknown) =>
  route.PATCH(
    new Request("http://localhost/api/sales/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

beforeEach(() => {
  db.settings = null;
  db.audits = [];
  db.salesMemberIds = new Set(["b", "r", "s"]);
  memberFindMany.mockClear();
  settingsDelegate.upsert.mockClear();
  requireAdminMock.mockReset().mockResolvedValue({ userId: "admin1", isAdmin: true });
});

describe("admin only", () => {
  it("refuses a member who is not an admin", async () => {
    requireAdminMock.mockRejectedValue(new PermissionError(403, "This action is for admins only."));

    expect((await route.GET()).status).toBe(403);
    expect((await patch({ leadAssignMode: "SINGLE" })).status).toBe(403);
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
    expect(db.audits).toEqual([]);
  });
});

describe("GET", () => {
  it("shows the defaults before anyone has saved anything", async () => {
    const res = await route.GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: [], singleAssigneeId: null },
    });
  });

  it("shows what was saved, and keeps the internal cursor to itself", async () => {
    db.settings = { id: "singleton", leadAssignMode: "SINGLE", roundRobinMemberIds: ["b"], singleAssigneeId: "r", rrCursor: 9 };

    const body = await (await route.GET()).json();

    expect(body).toEqual({ settings: { leadAssignMode: "SINGLE", roundRobinMemberIds: ["b"], singleAssigneeId: "r" } });
  });
});

describe("PATCH", () => {
  it("saves the rotation list and writes the change to the history log", async () => {
    const res = await patch({ roundRobinMemberIds: ["b", "r"] });

    expect(res.status).toBe(200);
    expect((await res.json()).settings).toEqual({
      leadAssignMode: "ROUND_ROBIN",
      roundRobinMemberIds: ["b", "r"],
      singleAssigneeId: null,
    });
    expect(db.audits).toEqual([
      {
        actorType: "USER",
        actorId: "admin1",
        botTokenId: null,
        entityType: "SalesSettings",
        entityId: "singleton",
        action: "updated",
        before: { roundRobinMemberIds: [] },
        after: { roundRobinMemberIds: ["b", "r"] },
      },
    ]);
  });

  it("checks everyone named, in one lookup, against the shared Sales-member rule", async () => {
    await patch({ roundRobinMemberIds: ["b", "r"], singleAssigneeId: "r" });

    expect(memberFindMany).toHaveBeenCalledTimes(1);
    expect(memberFindMany.mock.calls[0][0].where).toEqual({ id: { in: ["b", "r"] }, ...SALES_MEMBER_WHERE });
  });

  it("refuses a person without Sales access and saves nothing", async () => {
    const res = await patch({ roundRobinMemberIds: ["b", "outsider"] });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Choose team members with Sales access.");
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
    expect(db.audits).toEqual([]);
  });

  it("refuses a single assignee without Sales access", async () => {
    const res = await patch({ leadAssignMode: "SINGLE", singleAssigneeId: "outsider" });

    expect(res.status).toBe(400);
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
  });

  it("lists a person once even when sent twice", async () => {
    const res = await patch({ roundRobinMemberIds: ["b", "r", "b"] });

    expect((await res.json()).settings.roundRobinMemberIds).toEqual(["b", "r"]);
  });

  it("switches to one person for every lead", async () => {
    await patch({ roundRobinMemberIds: ["b", "r"] });
    const res = await patch({ leadAssignMode: "SINGLE", singleAssigneeId: "r" });

    expect(res.status).toBe(200);
    expect((await res.json()).settings).toEqual({
      leadAssignMode: "SINGLE",
      roundRobinMemberIds: ["b", "r"],
      singleAssigneeId: "r",
    });
    expect(db.audits[1]).toMatchObject({
      before: { leadAssignMode: "ROUND_ROBIN", singleAssigneeId: null },
      after: { leadAssignMode: "SINGLE", singleAssigneeId: "r" },
    });
  });

  it("refuses single-person mode when nobody is chosen", async () => {
    const res = await patch({ leadAssignMode: "SINGLE" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Choose the person who gets every new lead.");
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
  });

  it("accepts single-person mode when the person was already saved", async () => {
    db.settings = { id: "singleton", leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: [], singleAssigneeId: "r", rrCursor: 0 };

    expect((await patch({ leadAssignMode: "SINGLE" })).status).toBe(200);
  });

  it("never lets the caller set the rotation cursor", async () => {
    await patch({ roundRobinMemberIds: ["b"], rrCursor: 99 });

    const written = settingsDelegate.upsert.mock.calls[0][0];
    expect(written.create).not.toHaveProperty("rrCursor");
    expect(written.update).not.toHaveProperty("rrCursor");
  });

  it("writes no history row when nothing actually changed", async () => {
    db.settings = { id: "singleton", leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: ["b"], singleAssigneeId: null, rrCursor: 4 };

    const res = await patch({ roundRobinMemberIds: ["b"] });

    expect(res.status).toBe(200);
    expect(db.audits).toEqual([]);
  });

  it("does not log the cursor in the history", async () => {
    db.settings = { id: "singleton", leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: ["b"], singleAssigneeId: null, rrCursor: 4 };

    await patch({ roundRobinMemberIds: ["b", "r"] });

    expect(JSON.stringify(db.audits)).not.toContain("rrCursor");
  });

  it("rejects bad input", async () => {
    for (const body of [{}, { leadAssignMode: "RANDOM" }, { roundRobinMemberIds: "b" }, { singleAssigneeId: 7 }, null]) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
  });

  it("lets the single person be cleared", async () => {
    db.settings = { id: "singleton", leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: [], singleAssigneeId: "r", rrCursor: 0 };

    const res = await patch({ singleAssigneeId: null });

    expect(res.status).toBe(200);
    expect((await res.json()).settings.singleAssigneeId).toBeNull();
  });
});
