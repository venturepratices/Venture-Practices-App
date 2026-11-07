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
type Person = { id: string; name: string };
type MemberWhere = { id?: string | { in: string[] }; isAdmin?: boolean; OR?: unknown };
type MemberArgs = { where: MemberWhere; select: Row; orderBy?: unknown };

// Everyone on the team, who of them has Sales access (the real rule is
// SALES_MEMBER_WHERE: admins and anyone with the Sales switch), and the answer
// to "who is the first admin" (a canned row, so each test names its own members).
const TEAM: Person[] = [
  { id: "b", name: "Ben Example" },
  { id: "r", name: "Robert O." },
  { id: "s", name: "Sarah K." },
  { id: "x", name: "Dana Q." },
];
const db = {
  settings: null as Row | null,
  audits: [] as Row[],
  team: TEAM,
  salesMemberIds: new Set<string>(),
  firstAdmin: null as Person | null,
};

// Like Prisma: undefined fields are left alone, and only the selected fields come back
// (so the internal cursor never leaves unless a route asks for it).
const defined = (row: Row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
const selected = (row: Row | null, select: Row) =>
  row ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : null;

/** A team member lookup honours the `where` it gets: an id, a list of ids, the Sales-member rule. */
function matchesMember(person: Person, where: MemberWhere): boolean {
  const { id, OR, ...rest } = where;
  if (Object.keys(rest).length > 0) throw new Error(`Unexpected member filter: ${JSON.stringify(rest)}`);
  if (typeof id === "string" && person.id !== id) return false;
  if (typeof id === "object" && !id.in.includes(person.id)) return false;
  if (OR !== undefined) {
    // Only the shared rule is understood here; anything else is a bug in the code under test.
    expect({ OR }).toEqual(SALES_MEMBER_WHERE);
    if (!db.salesMemberIds.has(person.id)) return false;
  }
  return true;
}

const memberFindMany = vi.fn(async (args: MemberArgs) => {
  const rows = db.team.filter((person) => matchesMember(person, args.where));
  // loadSalesMembers asks for the list by name.
  if (args.orderBy) rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows.map((person) => selected(person, args.select));
});
const memberFindFirst = vi.fn(async (args: MemberArgs) => {
  if (args.where.isAdmin === true) return db.firstAdmin ? selected(db.firstAdmin, args.select) : null;
  const found = db.team.find((person) => matchesMember(person, args.where));
  return found ? selected(found, args.select) : null;
});
const teamMember = {
  findMany: (...args: unknown[]) => memberFindMany(...(args as [MemberArgs])),
  findFirst: (...args: unknown[]) => memberFindFirst(...(args as [MemberArgs])),
};

const settingsDelegate = {
  findUnique: async (args: { where: { id: string }; select: Row }) =>
    args.where.id === "singleton" ? selected(db.settings, args.select) : null,
  upsert: vi.fn(async (args: { where: { id: string }; create: Row; update: Row; select: Row }) => {
    if (db.settings) {
      Object.assign(db.settings, defined(args.update));
    } else {
      // Like the real column before it had a default: a list left out is stored as NULL.
      // The route has to send the list itself, or a later raw read gets null back.
      db.settings = { rrCursor: 0, leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: null, singleAssigneeId: null, ...defined(args.create) };
    }
    return selected(db.settings, args.select);
  }),
};
const tx = {
  salesSettings: settingsDelegate,
  teamMember,
  salesAuditLog: { create: async (args: { data: Row }) => db.audits.push(args.data) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesSettings: settingsDelegate,
    teamMember,
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}));

const route = await import("@/app/api/sales/settings/route");
const { PermissionError } = await import("@/lib/permissions");
const { SALES_MEMBER_WHERE } = await import("@/lib/sales/access");

const LOST_ACCESS = "The person who gets every new lead no longer has Sales access. Pick someone else.";
const SALES_ACCESS = "Choose team members with Sales access.";

const patchRaw = (body: string) =>
  route.PATCH(
    new Request("http://localhost/api/sales/settings", {
      method: "PATCH",
      body,
      headers: { "content-type": "application/json" },
    }),
  );
const patch = (body: unknown) => patchRaw(JSON.stringify(body));

/**
 * The calls a fake got before the settings row was written: the save's own
 * checks. A save answers with a fresh view read after it, which looks people up
 * again; those reads are not part of deciding whether the save is allowed.
 */
function callsBeforeSave<C>(mock: { mock: { calls: C[]; invocationCallOrder: number[] } }): C[] {
  const savedAt = settingsDelegate.upsert.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
  return mock.mock.calls.filter((_, index) => mock.mock.invocationCallOrder[index] < savedAt);
}

beforeEach(() => {
  db.settings = null;
  db.audits = [];
  db.salesMemberIds = new Set(["b", "r", "s"]);
  db.firstAdmin = { id: "m", name: "Mark Example" };
  memberFindMany.mockClear();
  memberFindFirst.mockClear();
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
      view: expect.any(Object),
    });
  });

  it("shows what was saved, and keeps the internal cursor to itself", async () => {
    db.settings = { id: "singleton", leadAssignMode: "SINGLE", roundRobinMemberIds: ["b"], singleAssigneeId: "r", rrCursor: 9 };

    const body = await (await route.GET()).json();

    expect(body).toEqual({
      settings: { leadAssignMode: "SINGLE", roundRobinMemberIds: ["b"], singleAssigneeId: "r" },
      view: expect.any(Object),
    });
    expect(JSON.stringify(body)).not.toContain("rrCursor");
  });

  it("shows who can get leads and who lost access", async () => {
    db.settings = { id: "singleton", leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: ["b", "x", "gone"], singleAssigneeId: null, rrCursor: 6 };
    db.salesMemberIds = new Set(["b", "r"]);

    const res = await route.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.settings).toEqual({ leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: ["b", "x", "gone"], singleAssigneeId: null });
    expect(body.view).toEqual({
      mode: "ROUND_ROBIN",
      members: [
        { id: "b", name: "Ben Example" },
        { id: "r", name: "Robert O." },
      ],
      rotation: [
        { id: "b", name: "Ben Example", hasAccess: true },
        { id: "x", name: "Dana Q.", hasAccess: false },
        { id: "gone", name: null, hasAccess: false },
      ],
      single: null,
      effective: { mode: "ROUND_ROBIN", names: ["Ben E."], fallbackName: null },
      firstAdminName: "Mark E.",
    });
    // The first admin is read the way the lead assigner reads them, so the card names the same person.
    expect(memberFindFirst).toHaveBeenCalledWith({
      where: { isAdmin: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { name: true },
    });
    expect(JSON.stringify(body)).not.toContain("rrCursor");
  });

  it("shows a saved single person who lost access, and who gets leads instead", async () => {
    db.settings = { id: "singleton", leadAssignMode: "SINGLE", roundRobinMemberIds: [], singleAssigneeId: "x", rrCursor: 0 };
    db.salesMemberIds = new Set(["b", "r"]);

    const body = await (await route.GET()).json();

    expect(body.view).toMatchObject({
      mode: "SINGLE",
      rotation: [],
      single: { id: "x", name: "Dana Q.", hasAccess: false },
      effective: { mode: "ROUND_ROBIN", names: [], fallbackName: "Mark E." },
      firstAdminName: "Mark E.",
    });
  });

  it("names nobody when the team has no admin", async () => {
    db.firstAdmin = null;

    const body = await (await route.GET()).json();

    expect(body.view.firstAdminName).toBeNull();
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
        ipAddress: null,
        userAgent: null,
      },
    ]);
  });

  it("answers a save with the saved settings and the view read after it", async () => {
    const body = await (await patch({ roundRobinMemberIds: ["r", "b"] })).json();

    expect(body.settings).toEqual({ leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: ["r", "b"], singleAssigneeId: null });
    expect(body.view).toMatchObject({
      mode: "ROUND_ROBIN",
      rotation: [
        { id: "r", name: "Robert O.", hasAccess: true },
        { id: "b", name: "Ben Example", hasAccess: true },
      ],
      single: null,
      effective: { mode: "ROUND_ROBIN", names: ["Robert O.", "Ben E."], fallbackName: null },
    });
    expect(JSON.stringify(body)).not.toContain("rrCursor");
  });

  it("records the caller's IP address and user agent on the history row", async () => {
    await route.PATCH(
      new Request("http://localhost/api/sales/settings", {
        method: "PATCH",
        body: JSON.stringify({ roundRobinMemberIds: ["b"] }),
        headers: { "content-type": "application/json", "x-real-ip": "198.51.100.4", "user-agent": "Admin browser" },
      }),
    );

    expect(db.audits[0]).toMatchObject({ ipAddress: "198.51.100.4", userAgent: "Admin browser" });
  });

  it("checks everyone named, in one lookup, against the shared Sales-member rule", async () => {
    await patch({ roundRobinMemberIds: ["b", "r"], singleAssigneeId: "r" });

    const checks = callsBeforeSave(memberFindMany);
    expect(checks).toHaveLength(1);
    expect(checks[0][0].where).toEqual({ id: { in: ["b", "r"] }, ...SALES_MEMBER_WHERE });
  });

  it("refuses a person without Sales access and saves nothing", async () => {
    const res = await patch({ roundRobinMemberIds: ["b", "outsider"] });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(SALES_ACCESS);
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
    expect(db.audits).toEqual([]);
  });

  it("refuses a rotation id without access plainly", async () => {
    const res = await patch({ roundRobinMemberIds: ["b", "x"] });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: SALES_ACCESS });
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
  });

  it("refuses a single assignee without Sales access", async () => {
    const res = await patch({ leadAssignMode: "SINGLE", singleAssigneeId: "outsider" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: SALES_ACCESS, code: "ASSIGNEE_LOST_ACCESS" });
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
  });

  it("names a single person without access with the same code", async () => {
    const res = await patch({ leadAssignMode: "SINGLE", singleAssigneeId: "x" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: SALES_ACCESS, code: "ASSIGNEE_LOST_ACCESS" });
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
    expect(db.audits).toEqual([]);
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
    expect(await res.json()).toEqual({ error: "Choose the person who gets every new lead." });
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
  });

  it("accepts single-person mode when the person was already saved", async () => {
    db.settings = { id: "singleton", leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: [], singleAssigneeId: "r", rrCursor: 0 };

    expect((await patch({ leadAssignMode: "SINGLE" })).status).toBe(200);
    expect(memberFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r", ...SALES_MEMBER_WHERE } }));
  });

  it("refuses single-person mode when the saved person no longer has Sales access", async () => {
    db.settings = { id: "singleton", leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: [], singleAssigneeId: "gone", rrCursor: 0 };

    const res = await patch({ leadAssignMode: "SINGLE" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: LOST_ACCESS, code: "ASSIGNEE_LOST_ACCESS" });
    expect(memberFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "gone", ...SALES_MEMBER_WHERE } }));
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
    expect(db.audits).toEqual([]);
  });

  it("re-checks the saved person on any save that stays in single-person mode", async () => {
    db.settings = { id: "singleton", leadAssignMode: "SINGLE", roundRobinMemberIds: [], singleAssigneeId: "gone", rrCursor: 0 };

    const res = await patch({ roundRobinMemberIds: ["b"] });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: LOST_ACCESS, code: "ASSIGNEE_LOST_ACCESS" });
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
  });

  it("explains a refused save when the single person lost access", async () => {
    // Ben E. was picked, then lost the Sales switch; an admin now edits the rotation.
    db.settings = { id: "singleton", leadAssignMode: "SINGLE", roundRobinMemberIds: ["b"], singleAssigneeId: "b", rrCursor: 2 };
    db.salesMemberIds = new Set(["r", "s"]);

    const res = await patch({ roundRobinMemberIds: ["r"] });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: LOST_ACCESS, code: "ASSIGNEE_LOST_ACCESS" });
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
    expect(db.settings.roundRobinMemberIds).toEqual(["b"]);
    expect(db.audits).toEqual([]);
  });

  it("does not re-check the single person when the request names them (they were already checked)", async () => {
    await patch({ leadAssignMode: "SINGLE", singleAssigneeId: "r" });

    expect(callsBeforeSave(memberFindFirst)).toEqual([]);
  });

  it("never stores a NULL rotation list when the first save leaves the list out", async () => {
    for (const body of [{ leadAssignMode: "ROUND_ROBIN" }, { singleAssigneeId: "r" }, { leadAssignMode: "SINGLE", singleAssigneeId: "r" }]) {
      db.settings = null;
      settingsDelegate.upsert.mockClear();

      const res = await patch(body);

      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(settingsDelegate.upsert.mock.calls[0][0].create.roundRobinMemberIds, JSON.stringify(body)).toEqual([]);
      expect((db.settings as Row | null)?.roundRobinMemberIds, JSON.stringify(body)).toEqual([]);
    }
  });

  it("leaves the saved list alone when a later save does not mention it", async () => {
    db.settings = { id: "singleton", leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: ["b", "r"], singleAssigneeId: null, rrCursor: 3 };

    await patch({ singleAssigneeId: "s" });

    expect(settingsDelegate.upsert.mock.calls[0][0].update.roundRobinMemberIds).toBeUndefined();
    expect(db.settings.roundRobinMemberIds).toEqual(["b", "r"]);
  });

  it("never lets the caller set the rotation cursor", async () => {
    const res = await patch({ roundRobinMemberIds: ["b"], rrCursor: 99 });

    expect(res.status).toBe(400);
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
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

  it("rejects unknown keys and bad values in Sales wording", async () => {
    const unknownKey = await patch({ rrCursor: 5 });
    expect(unknownKey.status).toBe(400);

    expect(await (await patch({ leadAssignMode: "WEIGHTED" })).json()).toEqual({ error: "Pick how new leads are shared out." });
    expect(await (await patch({})).json()).toEqual({ error: "Nothing to change." });
    expect(await (await patchRaw("{not json")).json()).toEqual({ error: "Invalid input." });

    const tooMany = Array.from({ length: 101 }, (_, index) => `m${index}`);
    expect(await (await patch({ roundRobinMemberIds: tooMany })).json()).toEqual({ error: "Choose up to 100 people." });
    expect(await (await patch({ singleAssigneeId: "z".repeat(65) })).json()).toEqual({ error: "Invalid input." });

    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
    expect(db.audits).toEqual([]);
  });

  it("blocks a change sent from another site and saves nothing", async () => {
    const res = await route.PATCH(
      new Request("http://localhost/api/sales/settings", {
        method: "PATCH",
        body: JSON.stringify({ roundRobinMemberIds: ["b"] }),
        headers: { "content-type": "application/json", host: "localhost", origin: "https://evil.example" },
      }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(settingsDelegate.upsert).not.toHaveBeenCalled();
    expect(db.audits).toEqual([]);
  });

  it("accepts a change sent from this site", async () => {
    const res = await route.PATCH(
      new Request("http://localhost/api/sales/settings", {
        method: "PATCH",
        body: JSON.stringify({ roundRobinMemberIds: ["b"] }),
        headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
      }),
    );

    expect(res.status).toBe(200);
  });

  it("lets the single person be cleared", async () => {
    db.settings = { id: "singleton", leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: [], singleAssigneeId: "r", rrCursor: 0 };

    const res = await patch({ singleAssigneeId: null });

    expect(res.status).toBe(200);
    expect((await res.json()).settings.singleAssigneeId).toBeNull();
  });
});
