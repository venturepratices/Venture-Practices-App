import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// The Leads Inbox: its URL query (client-safe parser and serializer), the
// `where` that keeps a see-own rep to their own open leads, the pages of 50
// newest first, each row's next step and Practice ZIP read with one query each,
// and the GET route behind "Show more". Run with a fake database and a fake
// Sales gate; nothing here reaches a real database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;
type LeadsQuery = import("@/lib/sales/leads-query").LeadsQuery;

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "s", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };

const MEMBERS = [
  { id: "b", name: "Ben S." },
  { id: "r", name: "Robert O." },
];

const state = { leads: [] as Row[], activities: [] as Row[], zips: [] as Row[] };

const db = {
  salesLead: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.leads) },
  salesActivity: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.activities) },
  salesCustomFieldValue: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.zips) },
  teamMember: {
    findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => MEMBERS),
    // The first admin, for the "who gets new leads" line when nothing is set up yet.
    findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => ({ name: "Dana Example" })),
  },
  salesSettings: { findUnique: vi.fn<(args: Args) => Promise<unknown>>(async () => null) },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { parseLeadsQuery, leadsQueryToSearch } = await import("@/lib/sales/leads-query");
const { leadsInboxWhere, loadLeadRows, loadLeadsPage } = await import("@/lib/sales/leads-page");
const leadsRoute = await import("@/app/api/sales/leads/route");
const { PermissionError } = await import("@/lib/permissions");

const DEFAULTS: LeadsQuery = { scope: "everyone", q: "", cursor: null };
const query = (patch: Partial<LeadsQuery> = {}): LeadsQuery => ({ ...DEFAULTS, ...patch });

const createdAt = new Date("2026-11-03T14:00:00.000Z");
const storedLead = (i: number, extra: Row = {}): Row => ({
  id: `l${i}`,
  title: `Lead ${i}`,
  source: "Added by hand",
  createdAt,
  ownerId: "r",
  person: null,
  organization: { name: `Practice ${i}` },
  ...extra,
});
const many = (count: number) => Array.from({ length: count }, (_, i) => storedLead(i + 1));

const ROW_SELECT = {
  id: true,
  title: true,
  source: true,
  createdAt: true,
  ownerId: true,
  person: { select: { name: true } },
  organization: { select: { name: true } },
};

const leadArgs = (call = 0) => db.salesLead.findMany.mock.calls[call][0];

beforeEach(() => {
  for (const delegate of Object.values(db)) for (const fn of Object.values(delegate)) fn.mockClear();
  state.leads = [];
  state.activities = [];
  state.zips = [];
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

describe("parseLeadsQuery and leadsQueryToSearch", () => {
  it("parses the Inbox URL", () => {
    expect(parseLeadsQuery({})).toEqual({ scope: "everyone", q: "", cursor: null });
    expect(parseLeadsQuery({ scope: "mine", q: "  oak " })).toEqual({ scope: "mine", q: "oak", cursor: null });
    expect(parseLeadsQuery({ scope: "all", q: "a" })).toEqual({ scope: "everyone", q: "", cursor: null });
    expect(parseLeadsQuery({ q: "x".repeat(150) }).q).toBe("x".repeat(100));
    expect(leadsQueryToSearch({ scope: "mine", q: "oak", cursor: "l9" })).toBe("scope=mine&q=oak");
    expect(leadsQueryToSearch({ scope: "everyone", q: "", cursor: null })).toBe("");
  });

  it("reads the first of a repeated param", () => {
    expect(parseLeadsQuery({ scope: ["mine", "everyone"], q: ["oak", "elm"] })).toEqual({
      scope: "mine",
      q: "oak",
      cursor: null,
    });
  });

  it("keeps a cursor of 1 to 64 characters and drops anything else", () => {
    expect(parseLeadsQuery({ cursor: "l9" }).cursor).toBe("l9");
    expect(parseLeadsQuery({ cursor: "c".repeat(64) }).cursor).toBe("c".repeat(64));
    expect(parseLeadsQuery({ cursor: "c".repeat(65) }).cursor).toBeNull();
    expect(parseLeadsQuery({ cursor: "" }).cursor).toBeNull();
  });

  it("is client-safe: no prisma and no next server imports", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "sales", "leads-query.ts"), "utf8");
    const imports = source.split("\n").filter((line) => line.startsWith("import "));

    for (const line of imports) {
      expect(line, line).not.toMatch(/@\/lib\/prisma|from "next\/|server-only|@\/generated\/prisma\/client/);
      if (line.includes("@/generated/prisma")) expect(line, line).toMatch(/^import type /);
    }
  });
});

describe("leadsInboxWhere", () => {
  it("shows open, live leads the person may see", () => {
    expect(leadsInboxWhere(rep, query())).toEqual({ status: "OPEN", archivedAt: null, ownerId: "r" });
    expect(leadsInboxWhere(admin, query())).toEqual({ status: "OPEN", archivedAt: null });
    expect(leadsInboxWhere(admin, query({ scope: "mine" }))).toEqual({ status: "OPEN", archivedAt: null, ownerId: "b" });
    expect(leadsInboxWhere(seesAll, query())).toEqual({ status: "OPEN", archivedAt: null });
  });

  it("searches the title, the organization and the person, ignoring case", () => {
    expect(leadsInboxWhere(rep, query({ q: "oak" }))).toEqual({
      status: "OPEN",
      archivedAt: null,
      ownerId: "r",
      OR: [
        { title: { contains: "oak", mode: "insensitive" } },
        { organization: { name: { contains: "oak", mode: "insensitive" } } },
        { person: { name: { contains: "oak", mode: "insensitive" } } },
      ],
    });
  });
});

describe("loadLeadRows", () => {
  it("pages newest first, 50 at a time", async () => {
    state.leads = many(51);
    const page = await loadLeadRows(rep, query());

    expect(db.salesLead.findMany).toHaveBeenCalledTimes(1);
    expect(leadArgs()).toEqual({
      where: { status: "OPEN", archivedAt: null, ownerId: "r" },
      select: ROW_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
    });
    expect(page.rows).toHaveLength(50);
    expect(page.rows.map((row) => row.id)).toEqual(many(50).map((row) => row.id));
    expect(page.nextCursor).toBe("l50");
    // Lists never read a person's email or phone (spec 3.10).
    const select = JSON.stringify(leadArgs().select);
    expect(select).not.toContain('"email"');
    expect(select).not.toContain('"phone"');
  });

  it("continues after the cursor", async () => {
    await loadLeadRows(rep, query({ cursor: "l50" }));

    expect(leadArgs()).toMatchObject({ cursor: { id: "l50" }, skip: 1, take: 51 });
  });

  it("answers no cursor on the last page", async () => {
    state.leads = many(50);
    const page = await loadLeadRows(rep, query());

    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toBeNull();
  });

  it("reads each lead's next step and ZIP with one query each", async () => {
    state.leads = [
      storedLead(1, { person: { name: "Sarah K." }, organization: { name: "Oak Creek Dental" } }),
      storedLead(2, { person: { name: "Laura B." }, organization: null, ownerId: "b", source: "Referral" }),
      storedLead(3, { person: null, organization: { name: "Elm Street Dental" } }),
    ];
    // As the database answers `orderBy: dueAt asc, id asc`.
    state.activities = [
      { leadId: "l2", type: "CALL", subject: "First call", dueAt: new Date("2026-11-04T15:00:00.000Z"), hasTime: true },
      { leadId: "l1", type: "MEETING", subject: "Demo", dueAt: new Date("2026-11-06T05:00:00.000Z"), hasTime: false },
      { leadId: "l2", type: "TASK", subject: "Send pricing", dueAt: new Date("2026-11-09T15:00:00.000Z"), hasTime: true },
    ];
    state.zips = [{ leadId: "l1", value: "78704" }];

    const page = await loadLeadRows(rep, query());

    expect(db.salesActivity.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesActivity.findMany.mock.calls[0][0]).toEqual({
      where: { leadId: { in: ["l1", "l2", "l3"] }, dealId: null, doneAt: null, archivedAt: null },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      select: { leadId: true, type: true, subject: true, dueAt: true, hasTime: true },
    });
    expect(db.salesCustomFieldValue.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesCustomFieldValue.findMany.mock.calls[0][0]).toEqual({
      where: { leadId: { in: ["l1", "l2", "l3"] }, field: { key: "practice-zip" } },
      select: { leadId: true, value: true },
    });
    expect(page).toEqual({
      rows: [
        {
          id: "l1",
          title: "Lead 1",
          source: "Added by hand",
          createdAt: "2026-11-03T14:00:00.000Z",
          ownerId: "r",
          personName: "Sarah K.",
          organizationName: "Oak Creek Dental",
          zip: "78704",
          next: { type: "MEETING", subject: "Demo", dueAt: "2026-11-06T05:00:00.000Z", hasTime: false },
        },
        {
          id: "l2",
          title: "Lead 2",
          source: "Referral",
          createdAt: "2026-11-03T14:00:00.000Z",
          ownerId: "b",
          personName: "Laura B.",
          organizationName: null,
          zip: null,
          next: { type: "CALL", subject: "First call", dueAt: "2026-11-04T15:00:00.000Z", hasTime: true },
        },
        {
          id: "l3",
          title: "Lead 3",
          source: "Added by hand",
          createdAt: "2026-11-03T14:00:00.000Z",
          ownerId: "r",
          personName: null,
          organizationName: "Elm Street Dental",
          zip: null,
          next: null,
        },
      ],
      nextCursor: null,
    });
  });

  it("reads next steps and ZIPs for the 50 rows shown, not the extra one", async () => {
    state.leads = many(51);
    await loadLeadRows(rep, query());

    const shownIds = many(50).map((row) => row.id);
    expect(db.salesActivity.findMany.mock.calls[0][0].where).toMatchObject({ leadId: { in: shownIds } });
    expect(db.salesCustomFieldValue.findMany.mock.calls[0][0].where).toMatchObject({ leadId: { in: shownIds } });
  });

  it("reads nothing more when the page is empty", async () => {
    const page = await loadLeadRows(rep, query());

    expect(page).toEqual({ rows: [], nextCursor: null });
    expect(db.salesActivity.findMany).not.toHaveBeenCalled();
    expect(db.salesCustomFieldValue.findMany).not.toHaveBeenCalled();
  });
});

describe("loadLeadsPage", () => {
  it("answers the first page, the team members and who gets new leads", async () => {
    state.leads = many(2);
    const data = await loadLeadsPage(rep, query({ scope: "mine", cursor: "l50" }));

    expect(leadArgs()).not.toHaveProperty("cursor");
    expect(leadArgs()).not.toHaveProperty("skip");
    expect(data).toEqual({
      query: { scope: "mine", q: "", cursor: null },
      rows: page2Rows(),
      nextCursor: null,
      members: MEMBERS,
      canSeeEveryone: false,
      assignment: { mode: "ROUND_ROBIN", names: [], fallbackName: "Dana E." },
    });
  });

  it("knows whether to offer Everyone / Just me", async () => {
    expect((await loadLeadsPage(rep, query())).canSeeEveryone).toBe(false);
    expect((await loadLeadsPage(admin, query())).canSeeEveryone).toBe(true);
    expect((await loadLeadsPage(seesAll, query())).canSeeEveryone).toBe(true);
  });
});

/** The two rows `many(2)` becomes, with no next step and no ZIP. */
function page2Rows() {
  return [1, 2].map((i) => ({
    id: `l${i}`,
    title: `Lead ${i}`,
    source: "Added by hand",
    createdAt: "2026-11-03T14:00:00.000Z",
    ownerId: "r",
    personName: null,
    organizationName: `Practice ${i}`,
    zip: null,
    next: null,
  }));
}

describe("GET /api/sales/leads", () => {
  const get = (search = "") => leadsRoute.GET(new Request(`http://localhost/api/sales/leads${search}`));

  it("refuses someone without Sales access and reads nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await get("?scope=mine");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have access to Sales." });
    const calls = Object.values(db).flatMap((delegate) => Object.values(delegate).flatMap((fn) => fn.mock.calls));
    expect(calls).toEqual([]);
  });

  it("continues after the cursor it is sent, with the same filters", async () => {
    state.leads = many(2);
    const res = await get("?scope=mine&cursor=l50");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: page2Rows(), nextCursor: null });
    expect(leadArgs()).toMatchObject({
      where: { status: "OPEN", archivedAt: null, ownerId: "r" },
      cursor: { id: "l50" },
      skip: 1,
      take: 51,
    });
  });

  it("ignores a cursor longer than 64 characters and answers the first page, not a 500", async () => {
    const res = await get(`?cursor=${"c".repeat(65)}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], nextCursor: null });
    expect(leadArgs()).not.toHaveProperty("cursor");
    expect(leadArgs()).not.toHaveProperty("skip");
  });
});
