import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// The Contacts page: its URL query (client-safe parser and serializer), the
// People and Organizations lists a person may see (Decision 18, A4), never a
// person's email or phone, open-deal counts that carry the same owner filter as
// the Deals board, pages of 50 by name, and the GET route behind "Show more".
// Run with a fake database and a fake Sales gate; nothing here reaches a real
// database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; select: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;
type ContactsQuery = import("@/lib/sales/contacts-query").ContactsQuery;

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "s", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };

const MEMBERS = [
  { id: "b", name: "Ben S." },
  { id: "r", name: "Robert O." },
];

const state = { people: [] as Row[], organizations: [] as Row[] };

const db = {
  salesPerson: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.people) },
  salesOrganization: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.organizations) },
  teamMember: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => MEMBERS) },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { parseContactsQuery, contactsQueryToSearch, contactKindFromPath, CONTACT_PATHS } = await import(
  "@/lib/sales/contacts-query"
);
const { loadContactRows, loadContactsPage } = await import("@/lib/sales/contacts-page");
const contactsRoute = await import("@/app/api/sales/contacts/[kind]/route");
const { PermissionError } = await import("@/lib/permissions");

const DEFAULTS: ContactsQuery = { tab: "people", scope: "everyone", q: "", cursor: null };
const query = (patch: Partial<ContactsQuery> = {}): ContactsQuery => ({ ...DEFAULTS, ...patch });

// What a see-own rep ("r") may see, written out by hand (Decision 18): their
// own contacts and the ones on a live deal or lead they own.
const REP_VISIBLE = {
  archivedAt: null,
  OR: [
    { ownerId: "r" },
    { deals: { some: { ownerId: "r", archivedAt: null } } },
    { leads: { some: { ownerId: "r", archivedAt: null } } },
  ],
};
const ALL_VISIBLE = { archivedAt: null };

const repOpenDeals = { deals: { where: { status: "OPEN", archivedAt: null, ownerId: "r" } } };
const everyOpenDeal = { deals: { where: { status: "OPEN", archivedAt: null } } };

const storedPerson = (i: number, extra: Row = {}): Row => ({
  id: `p${i}`,
  name: `Person ${i}`,
  ownerId: "r",
  organization: null,
  _count: { deals: 0 },
  ...extra,
});
const storedOrganization = (i: number, extra: Row = {}): Row => ({
  id: `o${i}`,
  name: `Practice ${i}`,
  ownerId: "r",
  people: [],
  _count: { deals: 0 },
  ...extra,
});
const manyPeople = (count: number) => Array.from({ length: count }, (_, i) => storedPerson(i + 1));

const personArgs = (call = 0) => db.salesPerson.findMany.mock.calls[call][0];
const organizationArgs = (call = 0) => db.salesOrganization.findMany.mock.calls[call][0];

beforeEach(() => {
  for (const delegate of Object.values(db)) for (const fn of Object.values(delegate)) fn.mockClear();
  state.people = [];
  state.organizations = [];
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

describe("contacts-query", () => {
  it("parses the Contacts URL", () => {
    expect(parseContactsQuery({})).toEqual({ tab: "people", scope: "everyone", q: "", cursor: null });
    expect(parseContactsQuery({ tab: "organizations", scope: "mine", q: " oak " })).toEqual({
      tab: "organizations",
      scope: "mine",
      q: "oak",
      cursor: null,
    });
    expect(parseContactsQuery({ tab: "deals" }).tab).toBe("people");
    expect(parseContactsQuery({ scope: "all" }).scope).toBe("everyone");
    expect(contactsQueryToSearch({ tab: "organizations", scope: "mine", q: "oak", cursor: "x" })).toBe(
      "tab=organizations&scope=mine&q=oak",
    );
    expect(contactsQueryToSearch(DEFAULTS)).toBe("");
    expect(contactsQueryToSearch(query({ q: "oak" }))).toBe("q=oak");
    expect(contactKindFromPath("people")).toBe("person");
    expect(contactKindFromPath("organizations")).toBe("organization");
    expect(contactKindFromPath("deals")).toBeNull();
    expect(contactKindFromPath("constructor")).toBeNull();
    expect(CONTACT_PATHS).toEqual({ person: "people", organization: "organizations" });
  });

  it("ignores a one-letter search, cuts a long one, and reads the first of a repeated param", () => {
    expect(parseContactsQuery({ q: "o" }).q).toBe("");
    expect(parseContactsQuery({ q: "x".repeat(150) }).q).toBe("x".repeat(100));
    expect(parseContactsQuery({ tab: ["organizations", "people"], q: ["oak", "elm"] })).toEqual({
      tab: "organizations",
      scope: "everyone",
      q: "oak",
      cursor: null,
    });
  });

  it("keeps a cursor of 1 to 64 characters and drops anything else", () => {
    expect(parseContactsQuery({ cursor: "p9" }).cursor).toBe("p9");
    expect(parseContactsQuery({ cursor: "c".repeat(64) }).cursor).toBe("c".repeat(64));
    expect(parseContactsQuery({ cursor: "c".repeat(65) }).cursor).toBeNull();
    expect(parseContactsQuery({ cursor: "" }).cursor).toBeNull();
  });

  it("is client-safe: no prisma and no next server imports", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "sales", "contacts-query.ts"), "utf8");
    const imports = source.split("\n").filter((line) => line.startsWith("import "));

    for (const line of imports) {
      expect(line, line).not.toMatch(/@\/lib\/prisma|from "next\/|server-only|@\/generated\/prisma\/client/);
      if (line.includes("@/generated/prisma")) expect(line, line).toMatch(/^import type /);
    }
  });
});

describe("loadContactRows: people", () => {
  it("lists people the person may see, never their email or phone", async () => {
    state.people = [
      storedPerson(1, { name: "Sarah K.", organization: { name: "Oak Creek Dental" }, _count: { deals: 2 } }),
      storedPerson(2, { name: "Laura B.", ownerId: "b" }),
    ];
    const page = await loadContactRows(rep, query());

    expect(db.salesPerson.findMany).toHaveBeenCalledTimes(1);
    expect(personArgs()).toEqual({
      where: REP_VISIBLE,
      select: {
        id: true,
        name: true,
        ownerId: true,
        organization: { select: { name: true } },
        _count: { select: repOpenDeals },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 51,
    });
    // Lists never read a person's email or phone (spec 3.10).
    const select = JSON.stringify(personArgs().select);
    expect(select).not.toContain('"email"');
    expect(select).not.toContain('"phone"');
    expect(db.salesOrganization.findMany).not.toHaveBeenCalled();
    expect(page).toEqual({
      rows: [
        { kind: "person", id: "p1", name: "Sarah K.", organizationName: "Oak Creek Dental", openDeals: 2, ownerId: "r" },
        { kind: "person", id: "p2", name: "Laura B.", organizationName: null, openDeals: 0, ownerId: "b" },
      ],
      nextCursor: null,
    });
  });

  it("counts every open deal for an admin or someone who sees everyone's", async () => {
    for (const actor of [admin, seesAll]) {
      db.salesPerson.findMany.mockClear();
      await loadContactRows(actor, query());

      expect(personArgs().where, actor.userId).toEqual(ALL_VISIBLE);
      expect(personArgs().select._count, actor.userId).toEqual({ select: everyOpenDeal });
    }
  });

  it("searches by name without loosening who is visible", async () => {
    await loadContactRows(rep, query({ q: "oak" }));

    expect(personArgs().where).toEqual({
      AND: [
        REP_VISIBLE,
        {
          OR: [
            { name: { contains: "oak", mode: "insensitive" } },
            { organization: { name: { contains: "oak", mode: "insensitive" } } },
          ],
        },
      ],
    });
  });

  it("Just me means contacts I own", async () => {
    await loadContactRows(rep, query({ scope: "mine" }));
    expect(personArgs().where).toEqual({ archivedAt: null, ownerId: "r" });

    await loadContactRows(admin, query({ scope: "mine" }));
    expect(personArgs(1).where).toEqual({ archivedAt: null, ownerId: "b" });
  });

  it("pages by 50", async () => {
    state.people = manyPeople(51);
    const page = await loadContactRows(rep, query());

    expect(page.rows).toHaveLength(50);
    expect(page.rows.map((row) => row.id)).toEqual(manyPeople(50).map((row) => row.id));
    expect(page.nextCursor).toBe("p50");
    expect(personArgs()).not.toHaveProperty("cursor");

    await loadContactRows(rep, query({ cursor: "p50" }));
    expect(personArgs(1)).toMatchObject({ cursor: { id: "p50" }, skip: 1, take: 51 });
  });

  it("answers no cursor on the last page", async () => {
    state.people = manyPeople(50);
    const page = await loadContactRows(rep, query());

    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toBeNull();
  });
});

describe("loadContactRows: organizations", () => {
  const organizationsQuery = (patch: Partial<ContactsQuery> = {}) => query({ tab: "organizations", ...patch });

  it("lists organizations with owner-filtered counts", async () => {
    state.organizations = [storedOrganization(1, { name: "Oak Creek Dental", _count: { deals: 3 } })];
    const page = await loadContactRows(rep, organizationsQuery());

    expect(db.salesOrganization.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesPerson.findMany).not.toHaveBeenCalled();
    expect(organizationArgs()).toEqual({
      where: REP_VISIBLE,
      select: {
        id: true,
        name: true,
        ownerId: true,
        people: { where: REP_VISIBLE, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1, select: { name: true } },
        _count: { select: repOpenDeals },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 51,
    });
    const select = JSON.stringify(organizationArgs().select);
    expect(select).not.toContain('"email"');
    expect(select).not.toContain('"phone"');
    expect(page.rows[0]).toMatchObject({ kind: "organization", id: "o1", openDeals: 3 });

    db.salesOrganization.findMany.mockClear();
    await loadContactRows(admin, organizationsQuery());
    expect(organizationArgs().select._count).toEqual({ select: everyOpenDeal });
  });

  it("names an organization's first visible person", async () => {
    state.organizations = [
      storedOrganization(1, { name: "Oak Creek Dental", people: [{ name: "Sarah K." }], _count: { deals: 1 } }),
      storedOrganization(2, { name: "Elm Street Dental", ownerId: "b" }),
    ];
    const page = await loadContactRows(rep, organizationsQuery());

    expect(page).toEqual({
      rows: [
        { kind: "organization", id: "o1", name: "Oak Creek Dental", contactName: "Sarah K.", openDeals: 1, ownerId: "r" },
        { kind: "organization", id: "o2", name: "Elm Street Dental", contactName: null, openDeals: 0, ownerId: "b" },
      ],
      nextCursor: null,
    });

    db.salesOrganization.findMany.mockClear();
    await loadContactRows(admin, organizationsQuery());
    expect((organizationArgs().select.people as Row).where).toEqual(ALL_VISIBLE);
  });

  it("searches by name without loosening who is visible", async () => {
    await loadContactRows(rep, organizationsQuery({ q: "oak" }));

    expect(organizationArgs().where).toEqual({ AND: [REP_VISIBLE, { name: { contains: "oak", mode: "insensitive" } }] });
  });

  it("Just me means organizations I own", async () => {
    await loadContactRows(rep, organizationsQuery({ scope: "mine" }));
    expect(organizationArgs().where).toEqual({ archivedAt: null, ownerId: "r" });
  });

  it("pages by 50", async () => {
    state.organizations = Array.from({ length: 51 }, (_, i) => storedOrganization(i + 1));
    const page = await loadContactRows(rep, organizationsQuery());

    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toBe("o50");

    await loadContactRows(rep, organizationsQuery({ cursor: "o50" }));
    expect(organizationArgs(1)).toMatchObject({ cursor: { id: "o50" }, skip: 1, take: 51 });
  });
});

describe("loadContactsPage", () => {
  it("answers the first page, the team members and whether to offer Everyone / Just me", async () => {
    state.people = [storedPerson(1, { name: "Sarah K." })];
    const data = await loadContactsPage(rep, query({ scope: "mine", cursor: "p50" }));

    expect(personArgs()).not.toHaveProperty("cursor");
    expect(personArgs()).not.toHaveProperty("skip");
    expect(data).toEqual({
      query: { tab: "people", scope: "mine", q: "", cursor: null },
      rows: [{ kind: "person", id: "p1", name: "Sarah K.", organizationName: null, openDeals: 0, ownerId: "r" }],
      nextCursor: null,
      members: MEMBERS,
      canSeeEveryone: false,
    });
    expect((await loadContactsPage(admin, query())).canSeeEveryone).toBe(true);
    expect((await loadContactsPage(seesAll, query())).canSeeEveryone).toBe(true);
  });
});

describe("GET /api/sales/contacts/[kind]", () => {
  const get = (kind: string, search = "") =>
    contactsRoute.GET(new Request(`http://localhost/api/sales/contacts/${kind}${search}`), {
      params: Promise.resolve({ kind }),
    });
  const allQueries = () => Object.values(db).flatMap((delegate) => Object.values(delegate).flatMap((fn) => fn.mock.calls));

  it("answers one page of people, searched", async () => {
    state.people = [storedPerson(1, { name: "Sarah K.", organization: { name: "Oak Creek Dental" } })];
    const res = await get("people", "?q=oak");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rows: [{ kind: "person", id: "p1", name: "Sarah K.", organizationName: "Oak Creek Dental", openDeals: 0, ownerId: "r" }],
      nextCursor: null,
    });
    expect(personArgs().where).toMatchObject({ AND: [REP_VISIBLE, expect.anything()] });
  });

  it("reads the list from the path, not from a tab param", async () => {
    await get("organizations", "?tab=people&scope=mine&cursor=o50");

    expect(db.salesPerson.findMany).not.toHaveBeenCalled();
    expect(organizationArgs()).toMatchObject({ where: { archivedAt: null, ownerId: "r" }, cursor: { id: "o50" }, skip: 1 });
  });

  it("refuses any other list", async () => {
    const res = await get("deals");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input." });
    expect(allQueries()).toEqual([]);
  });

  it("refuses someone without Sales access and reads nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await get("people", "?q=oak");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have access to Sales." });
    expect(allQueries()).toEqual([]);
  });
});
