import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Activities list: its URL query (client-safe parser and serializer), the
// `where` that always keeps the deal-or-lead visibility rule on (so a deal or
// lead moved to another rep never leaks its activities, and an activity that
// moved to a deal never shows through its lead), the pages of 50, and the GET
// route behind "Show more". Run with a fake database and a fake Sales gate;
// nothing here reaches a real database or a real session.

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
const { activitiesWhere, activityParentWhere, loadActivityRows, loadActivitiesPage } = await import(
  "@/lib/sales/activities-page"
);
const { salesDueCountWhere } = await import("@/lib/sales/nav");
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
  lead: null,
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
  lead: { select: { id: true, title: true, ownerId: true } },
};

/**
 * The deal-or-lead half of a `where`: a deal activity through its deal, or an
 * activity still on its lead (no deal) through that lead. `owner` is the
 * visibility rule (`{ ownerId }` for someone who sees only their own), and to-do
 * lists ask for open deals and leads only.
 */
const parents = (owner: Row, toDo: boolean) => [
  { dealId: { not: null }, deal: { archivedAt: null, ...(toDo ? { status: "OPEN" } : {}), ...owner } },
  { dealId: null, leadId: { not: null }, lead: { archivedAt: null, ...(toDo ? { status: "OPEN" } : {}), ...owner } },
];

/** The deal branch and the lead branch of a `where` built by activitiesWhere. */
function branches(where: Row): { deal: Row; lead: Row } {
  const or = where.OR as Row[];
  expect(or).toHaveLength(2);
  return { deal: or[0], lead: or[1] };
}

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
  it("lists deal and lead activities the person may see", () => {
    const open = activitiesWhere(rep, query({ when: "open" }), now);
    expect(open).toEqual({
      doneAt: null,
      archivedAt: null,
      OR: [
        { dealId: { not: null }, deal: { archivedAt: null, status: "OPEN", ownerId: "r" } },
        { dealId: null, leadId: { not: null }, lead: { archivedAt: null, status: "OPEN", ownerId: "r" } },
      ],
    });
    // The deal rule lives only inside its branch, so lead activities are not shut out.
    expect(open).not.toHaveProperty("dealId");
    expect(open).not.toHaveProperty("deal");

    expect(activitiesWhere(rep, query({ when: "done" }), now)).toEqual({
      doneAt: { not: null },
      archivedAt: null,
      OR: [
        { dealId: { not: null }, deal: { archivedAt: null, ownerId: "r" } },
        { dealId: null, leadId: { not: null }, lead: { archivedAt: null, ownerId: "r" } },
      ],
    });

    expect(activitiesWhere(rep, query({ when: "open", scope: "mine" }), now)).toEqual({
      doneAt: null,
      archivedAt: null,
      ownerId: "r",
      OR: parents({ ownerId: "r" }, true),
    });

    expect(activitiesWhere(rep, query({ when: "overdue" }), now)).toEqual({
      doneAt: null,
      archivedAt: null,
      dueAt: { lt: startOfDay("2026-11-05") },
      OR: parents({ ownerId: "r" }, true),
    });
  });

  it.each(["open", "overdue", "today", "done"] as const)(
    "always keeps the deal and lead visibility rules on (%s)",
    (when) => {
      const where = activitiesWhere(rep, query({ when }), now);
      const { deal, lead } = branches(where);

      expect(where.archivedAt).toBeNull();
      expect(deal).toMatchObject({ dealId: { not: null }, deal: { archivedAt: null, ownerId: "r" } });
      expect(lead).toMatchObject({ dealId: null, leadId: { not: null }, lead: { archivedAt: null, ownerId: "r" } });
      for (const parent of [deal.deal, lead.lead]) {
        if (when === "done") expect(parent).not.toHaveProperty("status");
        else expect(parent).toHaveProperty("status", "OPEN");
      }
    },
  );

  it("filters overdue activities by the team's calendar day", () => {
    expect(activitiesWhere(rep, query({ when: "overdue" }), now)).toEqual({
      doneAt: null,
      archivedAt: null,
      dueAt: { lt: startOfDay("2026-11-05") },
      OR: parents({ ownerId: "r" }, true),
    });
  });

  it("filters today's activities by the whole Eastern day", () => {
    expect(activitiesWhere(rep, query({ when: "today" }), now)).toEqual({
      doneAt: null,
      archivedAt: null,
      dueAt: { gte: startOfDay("2026-11-05"), lte: endOfDay("2026-11-05") },
      OR: parents({ ownerId: "r" }, true),
    });
  });

  it("still reads today as Nov 5 at 11:30 PM Eastern, when it is already Nov 6 in UTC (Review Focus 2)", () => {
    const lateEvening = new Date("2026-11-06T04:30:00Z");

    expect(activitiesWhere(rep, query({ when: "today" }), lateEvening).dueAt).toEqual({
      gte: startOfDay("2026-11-05"),
      lte: endOfDay("2026-11-05"),
    });
  });

  it("lists every open activity on open deals and open leads by default", () => {
    expect(activitiesWhere(rep, DEFAULTS, now)).toEqual({
      doneAt: null,
      archivedAt: null,
      OR: parents({ ownerId: "r" }, true),
    });
  });

  it("lists done activities on any deal or lead still there, whatever its status", () => {
    expect(activitiesWhere(rep, query({ when: "done" }), now)).toEqual({
      doneAt: { not: null },
      archivedAt: null,
      OR: parents({ ownerId: "r" }, false),
    });
  });

  it.each(["open", "done"] as const)(
    "gives someone who sees only their own deals both rules under Just me (%s): their activities, on their deals and leads",
    (when) => {
      const where = activitiesWhere(rep, query({ when, scope: "mine" }), now);
      const { deal, lead } = branches(where);

      expect(where.ownerId).toBe("r");
      expect(deal.deal).toMatchObject({ ownerId: "r" });
      expect(lead.lead).toMatchObject({ ownerId: "r" });
    },
  );

  it("gives an admin under Just me their own activities on any deal or lead", () => {
    const where = activitiesWhere(admin, query({ scope: "mine" }), now);

    expect(where).toEqual({
      doneAt: null,
      archivedAt: null,
      ownerId: "b",
      OR: parents({}, true),
    });
  });

  it("gives an admin, or someone who sees all deals, everyone's activities under Everyone", () => {
    for (const actor of [admin, seesAll]) {
      const where = activitiesWhere(actor, DEFAULTS, now);

      expect(where).not.toHaveProperty("ownerId");
      expect(where.OR).toEqual(parents({}, true));
    }
  });

  it("keeps a rep who sees only their own deals to those deals and leads under Everyone too", () => {
    const where = activitiesWhere(rep, DEFAULTS, now);

    expect(where).not.toHaveProperty("ownerId");
    expect(where.OR).toEqual(parents({ ownerId: "r" }, true));
  });

  it("filters by type", () => {
    expect(activitiesWhere(rep, query({ type: "MEETING" }), now)).toMatchObject({ type: "MEETING" });
    expect(activitiesWhere(rep, DEFAULTS, now)).not.toHaveProperty("type");
  });
});

describe("activityParentWhere", () => {
  it("names a deal activity through its deal and an activity still on its lead through that lead", () => {
    expect(activityParentWhere(rep, false)).toEqual({
      OR: [
        { dealId: { not: null }, deal: { archivedAt: null, status: "OPEN", ownerId: "r" } },
        { dealId: null, leadId: { not: null }, lead: { archivedAt: null, status: "OPEN", ownerId: "r" } },
      ],
    });
    expect(activityParentWhere(admin, true)).toEqual({
      OR: [
        { dealId: { not: null }, deal: { archivedAt: null } },
        { dealId: null, leadId: { not: null }, lead: { archivedAt: null } },
      ],
    });
  });

  it("an activity that moved to a deal never matches through its lead (Review Focus 1)", () => {
    // Convert sets dealId on the lead's open activities and keeps leadId. Such
    // an activity must answer only to its deal: a done call on a deal now owned
    // by another rep, or an open call on a converted lead, never shows through
    // the lead on Activities or in the due count.
    const leadBranches = [
      (activityParentWhere(rep, false).OR as Row[])[1],
      (activityParentWhere(rep, true).OR as Row[])[1],
      (salesDueCountWhere("r", now).OR as Row[])[1],
    ];
    for (const branch of leadBranches) {
      expect(branch).toHaveProperty("lead");
      expect(branch).toHaveProperty("dealId", null);
    }
  });
});

describe("loadActivityRows", () => {
  it("reads one bounded page of overdue activities, oldest due first, from the first row", async () => {
    await loadActivityRows(rep, query({ when: "overdue" }), now);

    expect(db.salesActivity.findMany.mock.calls[0][0]).toEqual({
      where: {
        doneAt: null,
        archivedAt: null,
        dueAt: { lt: startOfDay("2026-11-05") },
        OR: parents({ ownerId: "r" }, true),
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
          parent: { kind: "deal", id: "d1", title: "Deal 1", ownerId: "r" },
        },
        {
          id: "a2",
          type: "MEETING",
          subject: "Call 2",
          dueAt: dueAt.toISOString(),
          hasTime: false,
          doneAt: doneAt.toISOString(),
          ownerId: "r",
          parent: { kind: "deal", id: "d2", title: "Deal 2", ownerId: "r" },
        },
      ],
      nextCursor: null,
    });
  });

  it("a lead row names its lead", async () => {
    state.rows = [
      stored(1, { deal: null, lead: { id: "l1", title: "Crestview Dental", ownerId: "r" } }),
      stored(2),
      // Moved to a deal by a convert: leadId is kept, but the deal is where it lives now.
      stored(3, { lead: { id: "l3", title: "Maple Grove Dental", ownerId: "b" } }),
    ];
    const page = await loadActivityRows(rep, DEFAULTS, now);

    expect(db.salesActivity.findMany.mock.calls[0][0].select).toEqual(ROW_SELECT);
    expect(db.salesActivity.findMany.mock.calls[0][0].select).toHaveProperty("lead", {
      select: { id: true, title: true, ownerId: true },
    });
    expect(page.rows.map((row) => row.parent)).toEqual([
      { kind: "lead", id: "l1", title: "Crestview Dental", ownerId: "r" },
      { kind: "deal", id: "d2", title: "Deal 2", ownerId: "r" },
      { kind: "deal", id: "d3", title: "Deal 3", ownerId: "r" },
    ]);
    for (const row of page.rows) {
      expect(row).not.toHaveProperty("deal");
      expect(row).not.toHaveProperty("lead");
    }
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
      rows: many(50).map((row) => ({
        id: row.id,
        type: row.type,
        subject: row.subject,
        dueAt: dueAt.toISOString(),
        hasTime: row.hasTime,
        doneAt: row.doneAt,
        ownerId: row.ownerId,
        parent: { kind: "deal", ...(row.deal as Row) },
      })),
      nextCursor: "a50",
    });
    expect(db.salesActivity.findMany.mock.calls[0][0]).toMatchObject({
      where: { dueAt: { lt: startOfDay("2026-11-05") }, OR: parents({ ownerId: "r" }, true) },
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
