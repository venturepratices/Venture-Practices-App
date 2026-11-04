import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Activities list: its URL query (client-safe parser and serializer), the
// `where` that always keeps the deal-visibility rule on (so a deal moved to
// another rep never leaks its activities), the pages of 50, and the GET route
// behind "Show more". Run with a fake database and a fake Sales gate; nothing
// here reaches a real database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;
type ActivitiesQuery = import("@/lib/sales/activities-query").ActivitiesQuery;

const now = new Date("2026-11-05T15:00:00Z");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "s", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };

const state = { rows: [] as Row[] };

const MEMBERS = [
  { id: "b", name: "Ben S." },
  { id: "r", name: "Rachel P." },
];

const db = {
  salesActivity: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.rows) },
  teamMember: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => MEMBERS) },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { parseActivitiesQuery, activitiesQueryToSearch } = await import("@/lib/sales/activities-query");
const { activitiesWhere, loadActivityRows, loadActivitiesPage } = await import("@/lib/sales/activities-page");
const activitiesRoute = await import("@/app/api/sales/activities/route");
const { PermissionError } = await import("@/lib/permissions");
const { endOfDay, startOfDay } = await import("@/lib/utils");

const DEFAULTS: ActivitiesQuery = { when: "open", type: "all", scope: "everyone", cursor: null };
const query = (patch: Partial<ActivitiesQuery> = {}): ActivitiesQuery => ({ ...DEFAULTS, ...patch });

const dueAt = new Date("2026-11-04T15:00:00Z");
const stored = (i: number, extra: Row = {}): Row => ({
  id: `a${i}`,
  type: "CALL",
  subject: `Call ${i}`,
  dueAt,
  hasTime: true,
  doneAt: null,
  ownerId: "r",
  deal: { id: `d${i}`, title: `Deal ${i}`, ownerId: "r" },
  ...extra,
});
const many = (count: number) => Array.from({ length: count }, (_, i) => stored(i + 1));

const ROW_SELECT = {
  id: true,
  type: true,
  subject: true,
  dueAt: true,
  hasTime: true,
  doneAt: true,
  ownerId: true,
  deal: { select: { id: true, title: true, ownerId: true } },
};

beforeEach(() => {
  for (const delegate of Object.values(db)) for (const fn of Object.values(delegate)) fn.mockClear();
  state.rows = [];
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

describe("parseActivitiesQuery and activitiesQueryToSearch", () => {
  it("defaults to every open activity, every type, everyone's", () => {
    expect(parseActivitiesQuery({})).toEqual({ when: "open", type: "all", scope: "everyone", cursor: null });
  });

  it("falls back to the defaults for unknown values", () => {
    expect(parseActivitiesQuery({ type: "PARTY", when: "later", scope: "theirs" })).toEqual(DEFAULTS);
    expect(parseActivitiesQuery({ type: "meeting" })).toEqual(DEFAULTS);
  });

  it("reads known values and the first of a repeated param", () => {
    expect(parseActivitiesQuery({ when: ["today", "done"], type: "MEETING", scope: "mine", cursor: "a9" })).toEqual({
      when: "today",
      type: "MEETING",
      scope: "mine",
      cursor: "a9",
    });
    for (const when of ["open", "overdue", "today", "done"] as const) {
      expect(parseActivitiesQuery({ when }).when).toBe(when);
    }
    for (const type of ["CALL", "MEETING", "TASK", "DEADLINE", "EMAIL", "LUNCH"] as const) {
      expect(parseActivitiesQuery({ type }).type).toBe(type);
    }
  });

  it("keeps a cursor of 1 to 64 characters and drops anything else", () => {
    expect(parseActivitiesQuery({ cursor: "x".repeat(64) }).cursor).toBe("x".repeat(64));
    expect(parseActivitiesQuery({ cursor: "x".repeat(65) }).cursor).toBeNull();
    expect(parseActivitiesQuery({ cursor: "" }).cursor).toBeNull();
  });

  it("writes only non-default values, in the order when, type, scope, and never the cursor", () => {
    expect(activitiesQueryToSearch({ when: "today", type: "MEETING", scope: "mine", cursor: "a9" })).toBe(
      "when=today&type=MEETING&scope=mine",
    );
    expect(activitiesQueryToSearch(DEFAULTS)).toBe("");
    expect(activitiesQueryToSearch(query({ cursor: "a9" }))).toBe("");
    expect(activitiesQueryToSearch(query({ scope: "mine" }))).toBe("scope=mine");
  });

  it("reads back what it writes", () => {
    const written = query({ when: "done", type: "EMAIL", scope: "mine" });
    const search = new URLSearchParams(activitiesQueryToSearch(written));
    expect(parseActivitiesQuery(Object.fromEntries(search))).toEqual(written);
  });

  it("is client-safe: no prisma and no next server imports", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "sales", "activities-query.ts"), "utf8");
    const imports = source.split("\n").filter((line) => line.startsWith("import "));

    for (const line of imports) {
      expect(line, line).not.toMatch(/@\/lib\/prisma|from "next\/|server-only|@\/generated\/prisma\/client/);
      if (line.includes("@/generated/prisma")) expect(line, line).toMatch(/^import type /);
    }
  });
});

describe("activitiesWhere", () => {
  it.each(["open", "overdue", "today", "done"] as const)(
    "always keeps the deal-visibility rule on (%s)",
    (when) => {
      const where = activitiesWhere(rep, query({ when }), now);

      expect(where.deal).toMatchObject({ archivedAt: null, ownerId: "r" });
      expect(where.dealId).toEqual({ not: null });
      expect(where.archivedAt).toBeNull();
      if (when === "done") expect(where.deal).not.toHaveProperty("status");
      else expect(where.deal).toHaveProperty("status", "OPEN");
    },
  );

  it("filters overdue activities by the team's calendar day", () => {
    expect(activitiesWhere(rep, query({ when: "overdue" }), now)).toEqual({
      doneAt: null,
      archivedAt: null,
      dealId: { not: null },
      dueAt: { lt: startOfDay("2026-11-05") },
      deal: { status: "OPEN", archivedAt: null, ownerId: "r" },
    });
  });

  it("filters today's activities by the whole Eastern day", () => {
    expect(activitiesWhere(rep, query({ when: "today" }), now)).toEqual({
      doneAt: null,
      archivedAt: null,
      dealId: { not: null },
      dueAt: { gte: startOfDay("2026-11-05"), lte: endOfDay("2026-11-05") },
      deal: { status: "OPEN", archivedAt: null, ownerId: "r" },
    });
  });

  it("still reads today as Nov 5 at 11:30 PM Eastern, when it is already Nov 6 in UTC (Review Focus 2)", () => {
    const lateEvening = new Date("2026-11-06T04:30:00Z");

    expect(activitiesWhere(rep, query({ when: "today" }), lateEvening).dueAt).toEqual({
      gte: startOfDay("2026-11-05"),
      lte: endOfDay("2026-11-05"),
    });
  });

  it("lists every open activity on open deals by default", () => {
    expect(activitiesWhere(rep, DEFAULTS, now)).toEqual({
      doneAt: null,
      archivedAt: null,
      dealId: { not: null },
      deal: { status: "OPEN", archivedAt: null, ownerId: "r" },
    });
  });

  it("lists done activities on any deal still there, whatever its status", () => {
    expect(activitiesWhere(rep, query({ when: "done" }), now)).toEqual({
      doneAt: { not: null },
      archivedAt: null,
      dealId: { not: null },
      deal: { archivedAt: null, ownerId: "r" },
    });
  });

  it.each(["open", "done"] as const)(
    "gives someone who sees only their own deals both rules under Just me (%s): their activities, on their deals",
    (when) => {
      const where = activitiesWhere(rep, query({ when, scope: "mine" }), now);

      expect(where.ownerId).toBe("r");
      expect(where.deal).toMatchObject({ ownerId: "r" });
    },
  );

  it("gives an admin under Just me their own activities on any deal", () => {
    const where = activitiesWhere(admin, query({ scope: "mine" }), now);

    expect(where).toEqual({
      doneAt: null,
      archivedAt: null,
      dealId: { not: null },
      ownerId: "b",
      deal: { status: "OPEN", archivedAt: null },
    });
  });

  it("gives an admin, or someone who sees all deals, everyone's activities under Everyone", () => {
    for (const actor of [admin, seesAll]) {
      const where = activitiesWhere(actor, DEFAULTS, now);

      expect(where).not.toHaveProperty("ownerId");
      expect(where.deal).toEqual({ status: "OPEN", archivedAt: null });
    }
  });

  it("keeps a rep who sees only their own deals to those deals under Everyone too", () => {
    const where = activitiesWhere(rep, DEFAULTS, now);

    expect(where).not.toHaveProperty("ownerId");
    expect(where.deal).toEqual({ status: "OPEN", archivedAt: null, ownerId: "r" });
  });

  it("filters by type", () => {
    expect(activitiesWhere(rep, query({ type: "MEETING" }), now)).toMatchObject({ type: "MEETING" });
    expect(activitiesWhere(rep, DEFAULTS, now)).not.toHaveProperty("type");
  });
});

describe("loadActivityRows", () => {
  it("reads one bounded page of overdue activities, oldest due first, from the first row", async () => {
    await loadActivityRows(rep, query({ when: "overdue" }), now);

    expect(db.salesActivity.findMany.mock.calls[0][0]).toEqual({
      where: {
        doneAt: null,
        archivedAt: null,
        dealId: { not: null },
        dueAt: { lt: startOfDay("2026-11-05") },
        deal: { status: "OPEN", archivedAt: null, ownerId: "r" },
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 51,
      select: ROW_SELECT,
    });
  });

  it("orders done activities most recently done first", async () => {
    await loadActivityRows(rep, query({ when: "done" }), now);

    expect(db.salesActivity.findMany.mock.calls[0][0].orderBy).toEqual([{ doneAt: "desc" }, { id: "desc" }]);
  });

  it("continues after the cursor", async () => {
    await loadActivityRows(rep, query({ cursor: "a50" }), now);

    expect(db.salesActivity.findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: "a50" }, skip: 1, take: 51 });
  });

  it("answers 50 rows and the 50th id as the next cursor when there are more", async () => {
    state.rows = many(51);
    const page = await loadActivityRows(rep, DEFAULTS, now);

    expect(page.rows).toHaveLength(50);
    expect(page.rows[49].id).toBe("a50");
    expect(page.nextCursor).toBe("a50");
  });

  it("answers no cursor on the last page, with plain serializable rows", async () => {
    const doneAt = new Date("2026-11-05T14:00:00Z");
    state.rows = [stored(1), stored(2, { type: "MEETING", hasTime: false, doneAt })];
    const page = await loadActivityRows(rep, DEFAULTS, now);

    expect(page).toEqual({
      rows: [
        {
          id: "a1",
          type: "CALL",
          subject: "Call 1",
          dueAt: dueAt.toISOString(),
          hasTime: true,
          doneAt: null,
          ownerId: "r",
          deal: { id: "d1", title: "Deal 1", ownerId: "r" },
        },
        {
          id: "a2",
          type: "MEETING",
          subject: "Call 2",
          dueAt: dueAt.toISOString(),
          hasTime: false,
          doneAt: doneAt.toISOString(),
          ownerId: "r",
          deal: { id: "d2", title: "Deal 2", ownerId: "r" },
        },
      ],
      nextCursor: null,
    });
  });
});

describe("loadActivitiesPage", () => {
  it("answers the first page, the team members and whether Everyone / Just me shows", async () => {
    state.rows = many(51);
    const page = await loadActivitiesPage(rep, query({ when: "today", cursor: "a50" }), now);

    expect(db.salesActivity.findMany.mock.calls[0][0]).not.toHaveProperty("cursor");
    expect(db.salesActivity.findMany.mock.calls[0][0]).not.toHaveProperty("skip");
    expect(page.query).toEqual(query({ when: "today" }));
    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toBe("a50");
    expect(page.members).toEqual(MEMBERS);
    expect(page.canSeeEveryone).toBe(false);
  });

  it("shows Everyone / Just me to an admin and to someone who sees all deals", async () => {
    expect((await loadActivitiesPage(admin, DEFAULTS, now)).canSeeEveryone).toBe(true);
    expect((await loadActivitiesPage(seesAll, DEFAULTS, now)).canSeeEveryone).toBe(true);
  });
});

describe("GET /api/sales/activities", () => {
  const get = (search = "") => activitiesRoute.GET(new Request(`http://localhost/api/sales/activities${search}`));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses someone without Sales access and reads nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await get("?when=overdue");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have access to Sales." });
    expect(db.salesActivity.findMany).not.toHaveBeenCalled();
  });

  it("answers a page of the filtered list: 50 rows and the 50th id", async () => {
    state.rows = many(51);
    const res = await get("?when=overdue");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rows: many(50).map((row) => ({ ...row, dueAt: dueAt.toISOString() })),
      nextCursor: "a50",
    });
    expect(db.salesActivity.findMany.mock.calls[0][0]).toMatchObject({
      where: { dueAt: { lt: startOfDay("2026-11-05") }, deal: { status: "OPEN", archivedAt: null, ownerId: "r" } },
      take: 51,
    });
  });

  it("continues after the cursor it is sent, with the same filters", async () => {
    await get("?when=today&type=MEETING&scope=mine&cursor=a10");

    expect(db.salesActivity.findMany.mock.calls[0][0]).toMatchObject({
      where: { type: "MEETING", ownerId: "r", dueAt: { gte: startOfDay("2026-11-05"), lte: endOfDay("2026-11-05") } },
      cursor: { id: "a10" },
      skip: 1,
    });
  });

  it("ignores a cursor longer than 64 characters and answers the first page, not a 500", async () => {
    const res = await get(`?when=overdue&cursor=${"x".repeat(65)}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], nextCursor: null });
    expect(db.salesActivity.findMany.mock.calls[0][0]).not.toHaveProperty("cursor");
    expect(db.salesActivity.findMany.mock.calls[0][0]).not.toHaveProperty("skip");
  });
});
