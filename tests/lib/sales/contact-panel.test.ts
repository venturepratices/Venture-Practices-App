import { beforeEach, describe, expect, it, vi } from "vitest";

// The contact panel (Decision 19, A4): a person or an organization the viewer
// may see, the deals, leads and people on it that the viewer may see (20 each,
// with true counts), whether a person's organization may be opened, possible
// duplicates, who may edit and merge, and an old link to a merged contact
// opening the contact it was merged into. Also the panel and History routes.
// Run with a fake database and a fake Sales gate; nothing here reaches a real
// database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAllRep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };
const adminBot: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "bot", botTokenId: "t1" };

// What a see-own rep ("r") may see, written out by hand (Decision 18).
const REP_VISIBLE = {
  archivedAt: null,
  OR: [
    { ownerId: "r" },
    { deals: { some: { ownerId: "r", archivedAt: null } } },
    { leads: { some: { ownerId: "r", archivedAt: null } } },
  ],
};

const state = {
  /** People and organizations the visible lookup finds, by id (the test sets what this viewer may see). */
  people: new Map<string, Row>(),
  organizations: new Map<string, Row>(),
  /** Merged contact id -> the id it was merged into. */
  mergedInto: new Map<string, string>(),
  linkedPeople: [] as Row[],
  deals: [] as Row[],
  leads: [] as Row[],
  counts: { people: 0, deals: 0, leads: 0 },
  duplicates: [] as Row[],
  hiddenDuplicate: null as Row | null,
};

/** One `findFirst` for both contact tables: the merged-link lookup, the hidden-duplicate check, or the visible lookup by id. */
function contactFindFirst(visible: () => Map<string, Row>) {
  return async (args: Args): Promise<unknown> => {
    const where = args.where;
    if ("mergedIntoId" in where) {
      const keptId = state.mergedInto.get(where.id as string);
      return keptId ? { mergedIntoId: keptId } : null;
    }
    if ("AND" in where) return state.hiddenDuplicate;
    return visible().get(where.id as string) ?? null;
  };
}

const db = {
  salesPerson: {
    findFirst: vi.fn<(args: Args) => Promise<unknown>>(contactFindFirst(() => state.people)),
    // The duplicate lookup's `where` is an AND; an organization's people list is not.
    findMany: vi.fn<(args: Args) => Promise<unknown>>(async (args) => ("AND" in args.where ? state.duplicates : state.linkedPeople)),
    count: vi.fn<(args: Args) => Promise<unknown>>(async () => state.counts.people),
  },
  salesOrganization: {
    findFirst: vi.fn<(args: Args) => Promise<unknown>>(contactFindFirst(() => state.organizations)),
    findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.duplicates),
  },
  salesDeal: {
    findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.deals),
    count: vi.fn<(args: Args) => Promise<unknown>>(async () => state.counts.deals),
  },
  salesLead: {
    findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.leads),
    count: vi.fn<(args: Args) => Promise<unknown>>(async () => state.counts.leads),
  },
  salesAuditLog: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  salesNote: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
  teamMember: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => []) },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { loadContactPanel } = await import("@/lib/sales/contact-panel");
const panelRoute = await import("@/app/api/sales/contacts/[kind]/[contactId]/route");
const timelineRoute = await import("@/app/api/sales/contacts/[kind]/[contactId]/timeline/route");
const { PermissionError } = await import("@/lib/permissions");

const createdAt = new Date("2026-11-02T15:00:00.000Z");

const storedSarah = (extra: Row = {}): Row => ({
  id: "p1",
  name: "Sarah K.",
  email: "sarah@oak.example",
  phone: "(512) 555-0142",
  role: "Office manager",
  ownerId: "r",
  createdAt,
  emailKey: "sarah@oak.example",
  phoneKey: "5125550142",
  nameKey: "sarahk",
  organizationId: "o1",
  organization: { id: "o1", name: "Oak Creek Dental" },
  owner: { id: "r", name: "Rachel P." },
  ...extra,
});

const storedOak = (extra: Row = {}): Row => ({
  id: "o1",
  name: "Oak Creek Dental",
  phone: "(512) 555-0100",
  website: "https://oak.example/",
  address: "12 Oak St",
  zip: "78704",
  nameKey: "oakcreekdental",
  ownerId: "r",
  createdAt,
  owner: { id: "r", name: "Rachel P." },
  ...extra,
});

const storedDeal = { id: "d1", title: "Oak Creek Dental", status: "OPEN", valueCents: 1_440_000, stage: { name: "Proposal Sent" } };
const storedLead = { id: "l1", title: "Oak Creek Dental", status: "CONVERTED" };

const DEAL_SELECT = { id: true, title: true, status: true, valueCents: true, stage: { select: { name: true } } };
const LEAD_SELECT = { id: true, title: true, status: true };
const DEALS_OPEN_FIRST = [{ status: "asc" }, { updatedAt: "desc" }];
const LEADS_OPEN_FIRST = [{ status: "asc" }, { createdAt: "desc" }];

const allQueries = () => Object.values(db).flatMap((delegate) => Object.values(delegate).flatMap((fn) => fn.mock.calls));

beforeEach(() => {
  for (const delegate of Object.values(db)) for (const fn of Object.values(delegate)) fn.mockClear();
  state.people = new Map();
  state.organizations = new Map();
  state.mergedInto = new Map();
  state.linkedPeople = [];
  state.deals = [];
  state.leads = [];
  state.counts = { people: 0, deals: 0, leads: 0 };
  state.duplicates = [];
  state.hiddenDuplicate = null;
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

describe("loadContactPanel: a person", () => {
  it("shows a person with the deals and leads the viewer may see", async () => {
    state.people.set("p1", storedSarah());
    state.organizations.set("o1", storedOak());
    state.deals = [storedDeal];
    state.leads = [storedLead];
    state.counts = { people: 0, deals: 1, leads: 1 };
    state.duplicates = [{ id: "p2", name: "Sarah Example" }];

    const panel = await loadContactPanel(rep, "person", "p1");

    expect(db.salesPerson.findFirst.mock.calls[0][0].where).toEqual({ id: "p1", ...REP_VISIBLE });
    expect(db.salesDeal.findMany.mock.calls[0][0]).toEqual({
      where: { personId: "p1", archivedAt: null, ownerId: "r" },
      orderBy: DEALS_OPEN_FIRST,
      take: 20,
      select: DEAL_SELECT,
    });
    expect(db.salesLead.findMany.mock.calls[0][0]).toEqual({
      where: { personId: "p1", archivedAt: null, ownerId: "r" },
      orderBy: LEADS_OPEN_FIRST,
      take: 20,
      select: LEAD_SELECT,
    });
    // Duplicates by the person's stored keys, among the people this viewer may see.
    expect(db.salesPerson.findMany.mock.calls[0][0].where).toEqual({
      AND: [
        {
          id: { not: "p1" },
          archivedAt: null,
          OR: [{ emailKey: "sarah@oak.example" }, { phoneKey: "5125550142" }, { nameKey: "sarahk", organizationId: "o1" }],
        },
        REP_VISIBLE,
      ],
    });
    expect(panel).toEqual({
      kind: "person",
      person: {
        id: "p1",
        name: "Sarah K.",
        email: "sarah@oak.example",
        phone: "(512) 555-0142",
        role: "Office manager",
        organization: { id: "o1", name: "Oak Creek Dental", visible: true },
        owner: { id: "r", name: "Rachel P." },
        createdAt: "2026-11-02T15:00:00.000Z",
      },
      deals: [{ id: "d1", title: "Oak Creek Dental", status: "OPEN", stageName: "Proposal Sent", valueCents: 1_440_000 }],
      leads: [{ id: "l1", title: "Oak Creek Dental", status: "CONVERTED" }],
      counts: { deals: 1, leads: 1 },
      duplicates: { matches: [{ id: "p2", name: "Sarah Example" }], hiddenMatch: false },
      canEdit: true,
      canMerge: false,
      redirectedFrom: null,
    });
  });

  it("an admin sees every deal and lead on the person", async () => {
    state.people.set("p1", storedSarah({ ownerId: "s" }));
    await loadContactPanel(admin, "person", "p1");

    expect(db.salesPerson.findFirst.mock.calls[0][0].where).toEqual({ id: "p1", archivedAt: null });
    expect(db.salesDeal.findMany.mock.calls[0][0].where).toEqual({ personId: "p1", archivedAt: null });
    expect(db.salesLead.findMany.mock.calls[0][0].where).toEqual({ personId: "p1", archivedAt: null });
  });

  it("a person's hidden organization is not a link", async () => {
    state.people.set(
      "p1",
      storedSarah({ organizationId: "o5", organization: { id: "o5", name: "Bright Smile Dental" }, nameKey: null }),
    );
    // o5 belongs to "b" and has no deal or lead of r's: the visible lookup finds nothing.
    const hidden = await loadContactPanel(rep, "person", "p1");

    expect(db.salesOrganization.findFirst.mock.calls[0][0]).toEqual({ where: { id: "o5", ...REP_VISIBLE }, select: { id: true } });
    expect(hidden?.kind === "person" && hidden.person.organization).toEqual({ id: "o5", name: "Bright Smile Dental", visible: false });

    state.organizations.set("o5", { id: "o5" });
    const shown = await loadContactPanel(rep, "person", "p1");
    expect(shown?.kind === "person" && shown.person.organization).toEqual({ id: "o5", name: "Bright Smile Dental", visible: true });
  });

  it("a person with no organization looks none up", async () => {
    state.people.set("p1", storedSarah({ organizationId: null, organization: null }));
    const panel = await loadContactPanel(rep, "person", "p1");

    expect(panel?.kind === "person" && panel.person.organization).toBeNull();
    expect(db.salesOrganization.findFirst).not.toHaveBeenCalled();
  });

  it("counts what the lists would show, past the first 20", async () => {
    state.people.set("p1", storedSarah());
    state.deals = Array.from({ length: 20 }, (_, i) => ({ ...storedDeal, id: `d${i + 1}` }));
    state.counts = { people: 0, deals: 22, leads: 0 };
    const panel = await loadContactPanel(rep, "person", "p1");

    expect(db.salesDeal.count.mock.calls[0][0]).toEqual({ where: db.salesDeal.findMany.mock.calls[0][0].where });
    expect(db.salesLead.count.mock.calls[0][0]).toEqual({ where: db.salesLead.findMany.mock.calls[0][0].where });
    expect(db.salesDeal.count.mock.calls[0][0].where).toEqual({ personId: "p1", archivedAt: null, ownerId: "r" });
    expect(panel?.deals).toHaveLength(20);
    expect(panel?.counts).toEqual({ deals: 22, leads: 0 });
  });

  it("reads the lists, counts and duplicates side by side after the visible lookup", async () => {
    state.people.set("p1", storedSarah());
    let releaseDeals: (rows: Row[]) => void = () => {};
    db.salesDeal.findMany.mockImplementationOnce(() => new Promise((resolve) => (releaseDeals = resolve)));

    const pending = loadContactPanel(rep, "person", "p1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The deals list has not answered, yet every other read has started.
    expect(db.salesLead.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesDeal.count).toHaveBeenCalledTimes(1);
    expect(db.salesLead.count).toHaveBeenCalledTimes(1);
    expect(db.salesOrganization.findFirst).toHaveBeenCalledTimes(1);
    expect(db.salesPerson.findMany).toHaveBeenCalledTimes(1);
    releaseDeals([]);
    expect((await pending)?.deals).toEqual([]);
  });
});

describe("loadContactPanel: an organization", () => {
  it("an organization lists its visible people", async () => {
    state.organizations.set("o1", storedOak());
    state.linkedPeople = [{ id: "p1", name: "Sarah K." }];
    state.deals = [storedDeal];
    state.counts = { people: 1, deals: 1, leads: 0 };
    state.hiddenDuplicate = { id: "o9" };

    const panel = await loadContactPanel(rep, "organization", "o1");

    expect(db.salesOrganization.findFirst.mock.calls[0][0].where).toEqual({ id: "o1", ...REP_VISIBLE });
    expect(db.salesPerson.findMany.mock.calls[0][0]).toEqual({
      where: { organizationId: "o1", ...REP_VISIBLE },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 20,
      select: { id: true, name: true },
    });
    expect(db.salesDeal.findMany.mock.calls[0][0]).toEqual({
      where: { organizationId: "o1", archivedAt: null, ownerId: "r" },
      orderBy: DEALS_OPEN_FIRST,
      take: 20,
      select: DEAL_SELECT,
    });
    expect(db.salesLead.findMany.mock.calls[0][0]).toEqual({
      where: { organizationId: "o1", archivedAt: null, ownerId: "r" },
      orderBy: LEADS_OPEN_FIRST,
      take: 20,
      select: LEAD_SELECT,
    });
    // Duplicates by name and ZIP; a match this rep may not see is only a flag.
    expect(db.salesOrganization.findMany.mock.calls[0][0].where).toEqual({
      AND: [{ id: { not: "o1" }, archivedAt: null, nameKey: "oakcreekdental", OR: [{ zip: null }, { zip: "78704" }] }, REP_VISIBLE],
    });
    expect(panel).toEqual({
      kind: "organization",
      organization: {
        id: "o1",
        name: "Oak Creek Dental",
        phone: "(512) 555-0100",
        website: "https://oak.example/",
        address: "12 Oak St",
        zip: "78704",
        owner: { id: "r", name: "Rachel P." },
        createdAt: "2026-11-02T15:00:00.000Z",
      },
      people: [{ id: "p1", name: "Sarah K." }],
      deals: [{ id: "d1", title: "Oak Creek Dental", status: "OPEN", stageName: "Proposal Sent", valueCents: 1_440_000 }],
      leads: [],
      counts: { people: 1, deals: 1, leads: 0 },
      duplicates: { matches: [], hiddenMatch: true },
      canEdit: true,
      canMerge: false,
      redirectedFrom: null,
    });
  });

  it("counts what the lists would show, past the first 20", async () => {
    state.organizations.set("o1", storedOak());
    state.linkedPeople = Array.from({ length: 20 }, (_, i) => ({ id: `p${i + 1}`, name: `Person ${i + 1}` }));
    state.counts = { people: 35, deals: 3, leads: 21 };
    const panel = await loadContactPanel(rep, "organization", "o1");

    expect(db.salesPerson.count.mock.calls[0][0]).toEqual({ where: { organizationId: "o1", ...REP_VISIBLE } });
    expect(db.salesDeal.count.mock.calls[0][0]).toEqual({ where: { organizationId: "o1", archivedAt: null, ownerId: "r" } });
    expect(db.salesLead.count.mock.calls[0][0]).toEqual({ where: { organizationId: "o1", archivedAt: null, ownerId: "r" } });
    expect(panel?.kind === "organization" && panel.people).toHaveLength(20);
    expect(panel?.counts).toEqual({ people: 35, deals: 3, leads: 21 });
  });
});

describe("loadContactPanel: rights", () => {
  it("the owner or an admin edits; only an admin merges", async () => {
    state.people.set("p1", storedSarah());
    state.organizations.set("o1", storedOak());
    for (const kind of ["person", "organization"] as const) {
      const id = kind === "person" ? "p1" : "o1";
      expect(await loadContactPanel(rep, kind, id), kind).toMatchObject({ canEdit: true, canMerge: false });
      expect(await loadContactPanel(admin, kind, id), kind).toMatchObject({ canEdit: true, canMerge: true });
      // A bot key never merges, admin or not.
      expect(await loadContactPanel(adminBot, kind, id), kind).toMatchObject({ canMerge: false });
    }

    // Owned by "b", seen by "r" who sees everyone's: read-only.
    state.people.set("p1", storedSarah({ ownerId: "b", owner: { id: "b", name: "Ben S." } }));
    state.organizations.set("o1", storedOak({ ownerId: "b", owner: { id: "b", name: "Ben S." } }));
    for (const kind of ["person", "organization"] as const) {
      const id = kind === "person" ? "p1" : "o1";
      expect(await loadContactPanel(seesAllRep, kind, id), kind).toMatchObject({ canEdit: false, canMerge: false });
    }
  });
});

describe("loadContactPanel: missing and merged contacts", () => {
  const mergedLookup = { where: { id: "p2", mergedIntoId: { not: null } }, select: { mergedIntoId: true } };

  it("an old link to a merged contact opens the kept one", async () => {
    state.people.set("p1", storedSarah());
    state.mergedInto.set("p2", "p1");
    const panel = await loadContactPanel(rep, "person", "p2");

    expect(db.salesPerson.findFirst.mock.calls[0][0].where).toEqual({ id: "p2", ...REP_VISIBLE });
    expect(db.salesPerson.findFirst.mock.calls[1][0]).toEqual(mergedLookup);
    expect(db.salesPerson.findFirst.mock.calls[2][0].where).toEqual({ id: "p1", ...REP_VISIBLE });
    expect(panel).toMatchObject({ kind: "person", person: { id: "p1", name: "Sarah K." }, redirectedFrom: "p2" });
    // The lists are the kept person's.
    expect(db.salesDeal.findMany.mock.calls[0][0].where).toMatchObject({ personId: "p1" });
  });

  it("a merged link whose kept contact is hidden, or a link that was never merged, is not found", async () => {
    state.mergedInto.set("p2", "p1");
    expect(await loadContactPanel(rep, "person", "p2")).toBeNull();
    expect(db.salesDeal.findMany).not.toHaveBeenCalled();

    expect(await loadContactPanel(rep, "person", "p7")).toBeNull();
    expect(db.salesPerson.findFirst.mock.calls.at(-1)?.[0]).toEqual({
      where: { id: "p7", mergedIntoId: { not: null } },
      select: { mergedIntoId: true },
    });
  });

  it("follows only one hop", async () => {
    // p3 went into p2, then p2 went into p1: an old p3 link does not reach p1.
    state.people.set("p1", storedSarah());
    state.mergedInto.set("p3", "p2");
    state.mergedInto.set("p2", "p1");

    expect(await loadContactPanel(rep, "person", "p3")).toBeNull();
    const mergedLookups = db.salesPerson.findFirst.mock.calls.filter(([args]) => "mergedIntoId" in args.where);
    expect(mergedLookups).toHaveLength(1);
  });

  it("does the same for organizations", async () => {
    state.organizations.set("o1", storedOak());
    state.mergedInto.set("o2", "o1");
    const panel = await loadContactPanel(rep, "organization", "o2");

    expect(db.salesOrganization.findFirst.mock.calls[1][0]).toEqual({
      where: { id: "o2", mergedIntoId: { not: null } },
      select: { mergedIntoId: true },
    });
    expect(panel).toMatchObject({ kind: "organization", organization: { id: "o1" }, redirectedFrom: "o2" });
    expect(db.salesPerson.findFirst).not.toHaveBeenCalled();
  });
});

describe("GET /api/sales/contacts/[kind]/[contactId]", () => {
  const get = (kind: string, contactId: string) =>
    panelRoute.GET(new Request(`http://localhost/api/sales/contacts/${kind}/${contactId}`), {
      params: Promise.resolve({ kind, contactId }),
    });

  it("returns the panel", async () => {
    state.organizations.set("o1", storedOak());
    const res = await get("organizations", "o1");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "organization", organization: { id: "o1", createdAt: "2026-11-02T15:00:00.000Z" } });
  });

  it("answers 404 for a contact the person may not see", async () => {
    const res = await get("people", "p1");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Contact not found." });
  });

  it("refuses any other kind of record", async () => {
    const res = await get("deals", "d1");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input." });
    expect(allQueries()).toEqual([]);
  });

  it("refuses someone without Sales access and reads nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await get("people", "p1");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have access to Sales." });
    expect(allQueries()).toEqual([]);
  });
});

describe("GET /api/sales/contacts/[kind]/[contactId]/timeline", () => {
  const get = (kind: string, contactId: string, search = "") =>
    timelineRoute.GET(new Request(`http://localhost/api/sales/contacts/${kind}/${contactId}/timeline${search}`), {
      params: Promise.resolve({ kind, contactId }),
    });

  it("returns a page of the contact's History, from the cursor it is sent", async () => {
    state.people.set("p1", storedSarah());
    const res = await get("people", "p1", "?at=2026-11-04T12:00:00.000Z&id=log9");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [], nextCursor: null });
    const cursorAt = new Date("2026-11-04T12:00:00.000Z");
    expect(db.salesAuditLog.findMany.mock.calls[0][0].where).toEqual({
      entityType: "SalesPerson",
      entityId: "p1",
      OR: [{ at: { lt: cursorAt } }, { at: cursorAt, id: { lt: "log9" } }],
    });
  });

  it("answers 404 for a contact the person may not see", async () => {
    const res = await get("organizations", "o1");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Contact not found." });
    expect(db.salesAuditLog.findMany).not.toHaveBeenCalled();
  });

  it("refuses any other kind of record", async () => {
    const res = await get("leads", "l1");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input." });
    expect(allQueries()).toEqual([]);
  });

  it("refuses someone without Sales access and reads nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    expect((await get("people", "p1")).status).toBe(403);
    expect(allQueries()).toEqual([]);
  });
});
