import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Merging duplicate contacts (Task 11, Decision 20): only a signed-in admin
// previews or merges; both rows are written with guarded writes (a lost race
// rolls the whole try back, retries once, then answers 409); every link to the
// dropped contact moves to the kept one; blank details are filled, never
// overwritten; and every affected deal and lead gets a `contact_changed` row,
// all in one insert. Run against a fake database whose delegates record every
// call, and a fake Sales gate. Nothing here reaches a real database or session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; data?: Row; select?: Row; take?: number };
type SalesActor = import("@/lib/sales/access").SalesActor;

const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };
const seesAll: SalesActor = { userId: "s", isAdmin: false, seesAllDeals: true, via: "user" };
const bot: SalesActor = { userId: "z", isAdmin: false, seesAllDeals: true, via: "bot", botTokenId: "t1" };
const botOfAdmin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "bot", botTokenId: "t1" };

const NOW = new Date("2026-11-05T15:00:00.000Z");
/** When the kept and the dropped contact were last saved, as the merge read them. */
const KEPT_AT = new Date("2026-11-04T15:00:00.000Z");
const DROPPED_AT = new Date("2026-11-03T15:00:00.000Z");
const META = { ipAddress: "203.0.113.9", userAgent: null };
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 5_000 };

const ONLY_ADMIN = "Only an admin can merge contacts.";
const PICK_TWO = "Pick two different contacts.";
const NOT_FOUND = "Contact not found.";
const TOO_BIG = "This merge would move more than 500 records. It is too big to do here.";
const JUST_CHANGED = "One of these contacts just changed. Refresh and try again.";

const state = {
  people: [] as Row[],
  organizations: [] as Row[],
  deals: [] as Row[],
  leads: [] as Row[],
  notes: [] as Row[],
  activities: [] as Row[],
  /** Guarded writes on these ids that match nothing, as if another request changed the row first, and how many times. */
  raced: {} as Record<string, number>,
};

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => sameValue(row[key], value));
const selected = (row: Row, select?: Row) =>
  select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row;
const byId = (rows: Row[], id: unknown) => rows.find((row) => row.id === id);
const nameOf = (rows: Row[], id: unknown) => {
  const row = byId(rows, id);
  return row ? { id: row.id, name: row.name } : null;
};

/** A person or an organization: looked up live by id, counted by link, and written with guarded writes. */
const contactDelegate = (rows: () => Row[]) => ({
  findFirst: vi.fn(async (args: Args) => {
    const row = rows().find((candidate) => matches(candidate, args.where));
    return row ? selected(row, args.select) : null;
  }),
  count: vi.fn(async (args: Args) => rows().filter((row) => matches(row, args.where)).length),
  updateMany: vi.fn(async (args: Args) => {
    const id = args.where.id as string | undefined;
    if (id !== undefined && (state.raced[id] ?? 0) > 0) {
      state.raced[id] -= 1;
      return { count: 0 };
    }
    return { count: rows().filter((row) => matches(row, args.where)).length };
  }),
});

/** A deal, lead, note or activity: counted and repointed by contact, read with its other contact's name. */
const linkedDelegate = (rows: () => Row[]) => ({
  count: vi.fn(async (args: Args) => rows().filter((row) => matches(row, args.where)).length),
  findMany: vi.fn(async (args: Args) =>
    rows()
      .filter((row) => matches(row, args.where))
      .slice(0, args.take)
      .map((row) => ({
        id: row.id,
        ...(args.select?.organization ? { organization: nameOf(state.organizations, row.organizationId) } : {}),
        ...(args.select?.person ? { person: nameOf(state.people, row.personId) } : {}),
      })),
  ),
  updateMany: vi.fn(async (args: Args) => ({ count: rows().filter((row) => matches(row, args.where)).length })),
});

const db = {
  salesPerson: contactDelegate(() => state.people),
  salesOrganization: contactDelegate(() => state.organizations),
  salesDeal: linkedDelegate(() => state.deals),
  salesLead: linkedDelegate(() => state.leads),
  salesNote: linkedDelegate(() => state.notes),
  salesActivity: linkedDelegate(() => state.activities),
  salesAuditLog: {
    create: vi.fn(async (args: { data: Row }) => args.data),
    createMany: vi.fn(async (args: { data: Row[] }) => ({ count: args.data.length })),
  },
  // Typed with the options argument, so a test can read what each try asked for.
  $transaction: vi.fn<(fn: (tx: unknown) => unknown, options?: unknown) => Promise<unknown>>(
    async (fn): Promise<unknown> => fn(db),
  ),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { loadMergePreview, mergeContacts, MERGE_REPOINTS } = await import("@/lib/sales/contact-merge");
const mergeRoute = await import("@/app/api/sales/contacts/[kind]/[contactId]/merge/route");

// --- Fixtures ---

const OAK = {
  id: "o1",
  name: "Oak Creek Dental",
  phone: "(512) 555-0199",
  website: null,
  address: null,
  zip: null,
  archivedAt: null,
  mergedIntoId: null,
  updatedAt: KEPT_AT,
};
const OAK_TYPO = {
  id: "o2",
  name: "Oak-Creek Dental.",
  phone: "512-555-0100",
  website: "https://oakcreekdental.example/",
  address: null,
  zip: "78701",
  archivedAt: null,
  mergedIntoId: null,
  updatedAt: DROPPED_AT,
};
const SARAH_K = {
  id: "p1",
  name: "Sarah K.",
  email: null,
  phone: "(512) 555-0142",
  role: null,
  organizationId: null,
  archivedAt: null,
  mergedIntoId: null,
  updatedAt: KEPT_AT,
};
const SARAH_EXAMPLE = {
  id: "p2",
  name: "Sarah Example",
  email: "sarah@oak.example",
  phone: null,
  role: "Owner",
  organizationId: "o1",
  archivedAt: null,
  mergedIntoId: null,
  updatedAt: DROPPED_AT,
};
const DANA = {
  id: "p3",
  name: "Dana Q.",
  email: null,
  phone: null,
  role: null,
  organizationId: "o2",
  archivedAt: null,
  mergedIntoId: null,
  updatedAt: KEPT_AT,
};

/** n rows linked to a contact, with ids "<prefix>1".."<prefix>n". */
const linked = (prefix: string, n: number, link: Row) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, ...link }));

/** Who wrote a history row in these tests: admin "z", from the request META. */
const BY_ADMIN = { actorType: "USER", actorId: "z", botTokenId: null, ipAddress: "203.0.113.9", userAgent: null };

const auditRows = () => db.salesAuditLog.createMany.mock.calls.flatMap((call) => call[0].data);
const writes = () => [
  ...db.salesPerson.updateMany.mock.calls,
  ...db.salesOrganization.updateMany.mock.calls,
  ...db.salesDeal.updateMany.mock.calls,
  ...db.salesLead.updateMany.mock.calls,
  ...db.salesNote.updateMany.mock.calls,
  ...db.salesActivity.updateMany.mock.calls,
  ...db.salesAuditLog.create.mock.calls,
  ...db.salesAuditLog.createMany.mock.calls,
];
const counts = () => [
  ...db.salesPerson.count.mock.calls,
  ...db.salesOrganization.count.mock.calls,
  ...db.salesDeal.count.mock.calls,
  ...db.salesLead.count.mock.calls,
  ...db.salesNote.count.mock.calls,
  ...db.salesActivity.count.mock.calls,
];

beforeEach(() => {
  vi.clearAllMocks();
  state.people = [{ ...SARAH_K }, { ...SARAH_EXAMPLE }, { ...DANA }];
  state.organizations = [{ ...OAK }, { ...OAK_TYPO }];
  state.deals = [{ id: "d4", personId: "p2", organizationId: "o1" }];
  state.leads = [{ id: "l3", personId: "p2", organizationId: "o1" }];
  state.notes = linked("n", 4, { personId: "p2", organizationId: null });
  state.activities = linked("a", 2, { personId: "p2" });
  state.raced = {};
});

// --- The schema's links ---

const lowerFirst = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
const relationPattern = (target: string) =>
  new RegExp(String.raw`^\s+\w+\s+${target}\??\s+@relation\((?:(?:name:\s*)?"[^"]*",\s*)?fields:\s*\[(\w+)\]`);

/** Every `model.field` in the schema text that is a foreign key to `target`, sorted. */
function linksTo(schema: string, target: string): string[] {
  const pattern = relationPattern(target);
  const links: string[] = [];
  for (const [, model, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    for (const line of body.split(/\r?\n/)) {
      const match = pattern.exec(line);
      if (match) links.push(`${lowerFirst(model)}.${match[1]}`);
    }
  }
  return links.sort();
}

describe("MERGE_REPOINTS", () => {
  it("repoints every link the schema has", () => {
    // Prisma 7's runtime data model has no relationFromFields, so the schema text is the list of foreign keys.
    const schema = fs.readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");

    const toPeople = linksTo(schema, "SalesPerson");
    expect(toPeople.length).toBeGreaterThanOrEqual(4);
    expect(toPeople).toEqual([...MERGE_REPOINTS.person]);

    const toOrganizations = linksTo(schema, "SalesOrganization");
    expect(toOrganizations.length).toBeGreaterThanOrEqual(4);
    expect(toOrganizations).toEqual([...MERGE_REPOINTS.organization]);
  });

  it("reads named relations too (self-check of the pattern)", () => {
    const pattern = relationPattern("SalesPerson");
    expect(pattern.exec(`  person SalesPerson? @relation("Referrer", fields: [referrerId], references: [id])`)?.[1]).toBe(
      "referrerId",
    );
    expect(
      pattern.exec(`  person SalesPerson? @relation(name: "Referrer", fields: [referrerId], references: [id])`)?.[1],
    ).toBe("referrerId");
    // A back-relation list and an owner relation are not links to repoint.
    expect(pattern.exec(`  salesPeople SalesPerson[] @relation("SalesPersonOwner")`)).toBeNull();
    expect(relationPattern("SalesOrganization").exec(`  owner TeamMember @relation(fields: [ownerId], references: [id])`)).toBeNull();
  });
});

// --- Who may merge ---

describe("only signed-in admins preview or merge", () => {
  it.each([
    ["a non-admin who sees every deal", seesAll],
    ["a bot key", bot],
    ["a bot key of an admin", botOfAdmin],
  ])("refuses %s before reading anything", async (_who, actor) => {
    expect(await loadMergePreview(actor, "person", "p1", "p2", db as never)).toEqual({
      ok: false,
      status: 403,
      error: ONLY_ADMIN,
    });
    expect(await mergeContacts(actor, "person", "p1", "p2", META, NOW)).toEqual({ ok: false, status: 403, error: ONLY_ADMIN });

    expect(db.salesPerson.findFirst).not.toHaveBeenCalled();
    expect(counts()).toEqual([]);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});

describe("refuses a merge that makes no sense", () => {
  it("refuses the same contact twice, before reading anything", async () => {
    expect(await loadMergePreview(admin, "person", "p1", "p1", db as never)).toEqual({ ok: false, status: 400, error: PICK_TWO });
    expect(await mergeContacts(admin, "person", "p1", "p1", META, NOW)).toEqual({ ok: false, status: 400, error: PICK_TWO });
    expect(db.salesPerson.findFirst).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("looks each contact up live and not merged", async () => {
    await loadMergePreview(admin, "person", "p1", "p2", db as never);
    expect(db.salesPerson.findFirst.mock.calls.map((call) => call[0].where)).toEqual([
      { id: "p1", archivedAt: null, mergedIntoId: null },
      { id: "p2", archivedAt: null, mergedIntoId: null },
    ]);
  });

  it.each([
    ["the kept one is missing", "gone", "p2", () => {}],
    ["the dropped one is missing", "p1", "gone", () => {}],
    ["the dropped one is archived", "p1", "p2", () => (state.people[1].archivedAt = NOW)],
    ["the kept one was already merged", "p1", "p2", () => (state.people[0].mergedIntoId = "p3")],
    ["the dropped one was already merged", "p1", "p2", () => (state.people[1].mergedIntoId = "p3")],
  ])("answers not found when %s", async (_case, keepId, dropId, arrange) => {
    arrange();
    expect(await loadMergePreview(admin, "person", keepId, dropId, db as never)).toEqual({
      ok: false,
      status: 404,
      error: NOT_FOUND,
    });
    expect(await mergeContacts(admin, "person", keepId, dropId, META, NOW)).toEqual({ ok: false, status: 404, error: NOT_FOUND });
    expect(writes()).toEqual([]);
  });

  it("answers not found for a person merged as an organization", async () => {
    expect(await mergeContacts(admin, "organization", "p1", "p2", META, NOW)).toEqual({ ok: false, status: 404, error: NOT_FOUND });
    expect(db.salesPerson.findFirst).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});

describe("refuses a merge too big for one go", () => {
  it("refuses 510 records with a plain message and writes nothing", async () => {
    state.deals = linked("d", 300, { personId: "p2", organizationId: "o1" });
    state.leads = linked("l", 150, { personId: "p2", organizationId: "o1" });
    state.notes = linked("n", 60, { personId: "p2", organizationId: null });
    state.activities = [];

    expect(await mergeContacts(admin, "person", "p1", "p2", META, NOW)).toEqual({ ok: false, status: 400, error: TOO_BIG });
    expect(writes()).toEqual([]);
  });
});

describe("a big merge writes its history in one go", () => {
  it("moves exactly 500 records with one history insert and a long transaction", async () => {
    state.deals = linked("d", 300, { personId: "p2", organizationId: "o1" });
    state.leads = linked("l", 150, { personId: "p2", organizationId: "o1" });
    state.notes = linked("n", 50, { personId: "p2", organizationId: null });
    state.activities = [];

    const result = await mergeContacts(admin, "person", "p1", "p2", META, NOW);

    expect(result).toEqual({ ok: true, kept: { id: "p1", name: "Sarah K." } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), TRANSACTION_OPTIONS);
    expect(db.salesAuditLog.create).not.toHaveBeenCalled();
    expect(db.salesAuditLog.createMany).toHaveBeenCalledTimes(1);

    const rows = auditRows();
    const changed = rows.filter((row) => row.action === "contact_changed");
    expect(changed.filter((row) => row.entityType === "SalesDeal")).toHaveLength(300);
    expect(changed.filter((row) => row.entityType === "SalesLead")).toHaveLength(150);
    expect(changed[0]).toEqual({
      ...BY_ADMIN,
      entityType: "SalesDeal",
      entityId: "d1",
      action: "contact_changed",
      before: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p2", personName: "Sarah Example" },
      after: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p1", personName: "Sarah K.", merged: true },
    });
  });
});

// --- Merging ---

describe("mergeContacts: people", () => {
  it("merges two people, filling blanks and never overwriting", async () => {
    const result = await mergeContacts(admin, "person", "p1", "p2", META, NOW);
    expect(result).toEqual({ ok: true, kept: { id: "p1", name: "Sarah K." } });

    // The kept row first (its phone stays; its blanks are filled; every key recomputed), then the dropped one.
    expect(db.salesPerson.updateMany.mock.calls.map((call) => call[0])).toEqual([
      {
        where: { id: "p1", archivedAt: null, mergedIntoId: null, updatedAt: KEPT_AT },
        data: {
          email: "sarah@oak.example",
          role: "Owner",
          organizationId: "o1",
          nameKey: "sarahk",
          emailKey: "sarah@oak.example",
          phoneKey: "5125550142",
        },
      },
      { where: { id: "p2", archivedAt: null, mergedIntoId: null }, data: { archivedAt: NOW, mergedIntoId: "p1" } },
    ]);

    // Every link moves, whatever state the linked row is in.
    for (const delegate of [db.salesDeal, db.salesLead, db.salesActivity, db.salesNote]) {
      expect(delegate.updateMany.mock.calls).toEqual([[{ where: { personId: "p2" }, data: { personId: "p1" } }]]);
    }
    expect(db.salesOrganization.updateMany).not.toHaveBeenCalled();

    expect(auditRows()).toEqual([
      {
        ...BY_ADMIN,
        entityType: "SalesDeal",
        entityId: "d4",
        action: "contact_changed",
        before: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p2", personName: "Sarah Example" },
        after: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p1", personName: "Sarah K.", merged: true },
      },
      {
        ...BY_ADMIN,
        entityType: "SalesLead",
        entityId: "l3",
        action: "contact_changed",
        before: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p2", personName: "Sarah Example" },
        after: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p1", personName: "Sarah K.", merged: true },
      },
      {
        ...BY_ADMIN,
        entityType: "SalesPerson",
        entityId: "p1",
        action: "merged",
        after: {
          droppedId: "p2",
          dropped: { name: "Sarah Example", email: "sarah@oak.example", phone: null, role: "Owner", organizationId: "o1" },
        },
      },
      {
        ...BY_ADMIN,
        entityType: "SalesPerson",
        entityId: "p2",
        action: "merged_into",
        after: { keptId: "p1", keptName: "Sarah K." },
      },
    ]);
  });

  it("writes the kept row, then the dropped row, then the links, then history", async () => {
    await mergeContacts(admin, "person", "p1", "p2", META, NOW);
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder;
    const [keptWrite, droppedWrite] = order(db.salesPerson.updateMany);
    const firstLinkWrite = Math.min(
      ...[db.salesDeal, db.salesLead, db.salesActivity, db.salesNote].flatMap((delegate) => order(delegate.updateMany)),
    );
    const lastRead = Math.max(...order(db.salesPerson.findFirst), ...order(db.salesDeal.count), ...order(db.salesNote.count));
    expect(lastRead).toBeLessThan(keptWrite);
    expect(keptWrite).toBeLessThan(droppedWrite);
    expect(droppedWrite).toBeLessThan(firstLinkWrite);
    // The affected deals and leads are read before any link moves, so each row names the contact it had.
    expect(Math.max(...order(db.salesDeal.findMany), ...order(db.salesLead.findMany))).toBeLessThan(firstLinkWrite);
    expect(order(db.salesAuditLog.createMany)[0]).toBeGreaterThan(firstLinkWrite);
  });

  it("the kept person's practice wins", async () => {
    state.people[0].organizationId = "o5";
    state.organizations.push({ ...OAK, id: "o5", name: "Elm Street Dental" });

    await mergeContacts(admin, "person", "p1", "p2", META, NOW);

    const keptData = db.salesPerson.updateMany.mock.calls[0][0].data as Row;
    expect(keptData).not.toHaveProperty("organizationId");
    expect(keptData).toEqual({
      email: "sarah@oak.example",
      role: "Owner",
      nameKey: "sarahk",
      emailKey: "sarah@oak.example",
      phoneKey: "5125550142",
    });
    // Deals and leads keep their own practice.
    expect(auditRows()[0].after).toEqual({
      organizationId: "o1",
      organizationName: "Oak Creek Dental",
      personId: "p1",
      personName: "Sarah K.",
      merged: true,
    });
  });

  it("treats an empty detail on the kept person as blank", async () => {
    state.people[0].email = "";
    await mergeContacts(admin, "person", "p1", "p2", META, NOW);
    expect((db.salesPerson.updateMany.mock.calls[0][0].data as Row).email).toBe("sarah@oak.example");
  });
});

describe("mergeContacts: organizations", () => {
  beforeEach(() => {
    state.people = [{ ...DANA }];
    state.deals = [{ id: "d7", personId: "p3", organizationId: "o2" }];
    state.leads = [{ id: "l8", personId: null, organizationId: "o2" }];
    state.notes = linked("n", 2, { personId: null, organizationId: "o2" });
    state.activities = [];
  });

  it("merges two practices", async () => {
    const result = await mergeContacts(admin, "organization", "o1", "o2", META, NOW);
    expect(result).toEqual({ ok: true, kept: { id: "o1", name: "Oak Creek Dental" } });

    expect(db.salesOrganization.updateMany.mock.calls.map((call) => call[0])).toEqual([
      {
        where: { id: "o1", archivedAt: null, mergedIntoId: null, updatedAt: KEPT_AT },
        // The kept phone stays; the blank website and ZIP are filled; the name key is recomputed.
        data: { website: "https://oakcreekdental.example/", zip: "78701", nameKey: "oakcreekdental" },
      },
      { where: { id: "o2", archivedAt: null, mergedIntoId: null }, data: { archivedAt: NOW, mergedIntoId: "o1" } },
    ]);
    for (const delegate of [db.salesPerson, db.salesDeal, db.salesLead, db.salesNote]) {
      expect(delegate.updateMany.mock.calls).toEqual([[{ where: { organizationId: "o2" }, data: { organizationId: "o1" } }]]);
    }
    expect(db.salesActivity.updateMany).not.toHaveBeenCalled();

    expect(auditRows()).toEqual([
      {
        ...BY_ADMIN,
        entityType: "SalesDeal",
        entityId: "d7",
        action: "contact_changed",
        before: { organizationId: "o2", organizationName: "Oak-Creek Dental.", personId: "p3", personName: "Dana Q." },
        after: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: "p3", personName: "Dana Q.", merged: true },
      },
      {
        ...BY_ADMIN,
        entityType: "SalesLead",
        entityId: "l8",
        action: "contact_changed",
        before: { organizationId: "o2", organizationName: "Oak-Creek Dental.", personId: null, personName: null },
        after: { organizationId: "o1", organizationName: "Oak Creek Dental", personId: null, personName: null, merged: true },
      },
      {
        ...BY_ADMIN,
        entityType: "SalesOrganization",
        entityId: "o1",
        action: "merged",
        after: {
          droppedId: "o2",
          dropped: {
            name: "Oak-Creek Dental.",
            phone: "512-555-0100",
            website: "https://oakcreekdental.example/",
            address: null,
            zip: "78701",
          },
        },
      },
      {
        ...BY_ADMIN,
        entityType: "SalesOrganization",
        entityId: "o2",
        action: "merged_into",
        after: { keptId: "o1", keptName: "Oak Creek Dental" },
      },
    ]);
  });

  it("reads each affected deal's and lead's person, not its title", async () => {
    await mergeContacts(admin, "organization", "o1", "o2", META, NOW);
    for (const delegate of [db.salesDeal, db.salesLead]) {
      const args = delegate.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ organizationId: "o2" });
      expect(args.select).toEqual({ id: true, person: { select: { id: true, name: true } } });
    }
  });
});

describe("a race rolls the merge back and answers 409", () => {
  it("answers 409 when the dropped row's guarded write misses on both tries", async () => {
    state.raced = { p2: 2 };

    expect(await mergeContacts(admin, "person", "p1", "p2", META, NOW)).toEqual({ ok: false, status: 409, error: JUST_CHANGED });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.$transaction.mock.calls.map((call) => call[1])).toEqual([TRANSACTION_OPTIONS, TRANSACTION_OPTIONS]);
    // Each try's function rejected, so its kept-row write rolled back with it.
    expect(db.$transaction.mock.settledResults.map((settled) => settled.type)).toEqual(["rejected", "rejected"]);
    expect(db.salesDeal.updateMany).not.toHaveBeenCalled();
    expect(db.salesAuditLog.createMany).not.toHaveBeenCalled();
  });

  it("answers 409 when the kept row changed on both tries", async () => {
    state.raced = { p1: 2 };
    expect(await mergeContacts(admin, "person", "p1", "p2", META, NOW)).toEqual({ ok: false, status: 409, error: JUST_CHANGED });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.salesAuditLog.createMany).not.toHaveBeenCalled();
  });

  it("merges on the second try after losing once", async () => {
    state.raced = { p2: 1 };

    expect(await mergeContacts(admin, "person", "p1", "p2", META, NOW)).toEqual({ ok: true, kept: { id: "p1", name: "Sarah K." } });

    expect(db.$transaction.mock.settledResults.map((settled) => settled.type)).toEqual(["rejected", "fulfilled"]);
    expect(db.salesAuditLog.createMany).toHaveBeenCalledTimes(1);
    expect(auditRows().map((row) => row.action)).toEqual(["contact_changed", "contact_changed", "merged", "merged_into"]);
  });
});

// --- Preview ---

describe("previews what will move", () => {
  it("counts every row linked to a person, archived ones included", async () => {
    expect(await loadMergePreview(admin, "person", "p1", "p2", db as never)).toEqual({
      ok: true,
      keep: { id: "p1", name: "Sarah K." },
      drop: { id: "p2", name: "Sarah Example" },
      counts: { people: 0, deals: 1, leads: 1, notes: 4, activities: 2 },
    });
    for (const delegate of [db.salesDeal, db.salesLead, db.salesNote, db.salesActivity]) {
      expect(delegate.count.mock.calls).toEqual([[{ where: { personId: "p2" } }]]);
    }
    expect(db.salesPerson.count).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("counts an organization's people, deals, leads and notes", async () => {
    state.deals = [{ id: "d7", personId: "p3", organizationId: "o2" }];
    state.leads = [];
    state.notes = linked("n", 3, { personId: null, organizationId: "o2" });

    expect(await loadMergePreview(admin, "organization", "o1", "o2", db as never)).toEqual({
      ok: true,
      keep: { id: "o1", name: "Oak Creek Dental" },
      drop: { id: "o2", name: "Oak-Creek Dental." },
      counts: { people: 1, deals: 1, leads: 0, notes: 3, activities: 0 },
    });
    for (const delegate of [db.salesPerson, db.salesDeal, db.salesLead, db.salesNote]) {
      expect(delegate.count.mock.calls).toEqual([[{ where: { organizationId: "o2" } }]]);
    }
    expect(db.salesActivity.count).not.toHaveBeenCalled();
  });
});

// --- Routes ---

const BASE = "http://localhost/api/sales/contacts";
const HEADERS = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };

const getPreview = (kind: string, contactId: string, search = "") =>
  mergeRoute.GET(new Request(`${BASE}/${kind}/${contactId}/merge${search}`), {
    params: Promise.resolve({ kind, contactId }),
  });
const postMerge = (kind: string, contactId: string, body: unknown, headers: Record<string, string> = {}) =>
  mergeRoute.POST(
    new Request(`${BASE}/${kind}/${contactId}/merge`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { ...HEADERS, ...headers },
    }),
    { params: Promise.resolve({ kind, contactId }) },
  );

describe("GET /api/sales/contacts/[kind]/[contactId]/merge", () => {
  it("previews a merge for an admin", async () => {
    requireSalesUserMock.mockResolvedValue(admin);
    const res = await getPreview("people", "p1", "?with=p2");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      keep: { id: "p1", name: "Sarah K." },
      drop: { id: "p2", name: "Sarah Example" },
      counts: { people: 0, deals: 1, leads: 1, notes: 4, activities: 2 },
    });
  });

  it.each([
    ["no with", ""],
    ["an empty with", "?with="],
    ["a with over 64 characters", `?with=${"x".repeat(65)}`],
  ])("refuses %s as invalid input", async (_case, search) => {
    requireSalesUserMock.mockResolvedValue(admin);
    const res = await getPreview("people", "p1", search);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input." });
    expect(counts()).toEqual([]);
  });

  it("refuses a path that names no kind of contact", async () => {
    requireSalesUserMock.mockResolvedValue(admin);
    const res = await getPreview("teams", "p1", "?with=p2");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input." });
  });

  it("refuses a non-admin who sees every deal, with no count query", async () => {
    requireSalesUserMock.mockResolvedValue(seesAll);
    const res = await getPreview("people", "p1", "?with=p2");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ONLY_ADMIN });
    expect(counts()).toEqual([]);
    expect(db.salesPerson.findFirst).not.toHaveBeenCalled();
  });
});

describe("POST /api/sales/contacts/[kind]/[contactId]/merge", () => {
  it("merges for an admin and records where the request came from", async () => {
    requireSalesUserMock.mockResolvedValue(admin);
    const res = await postMerge("people", "p1", { dropId: "p2" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kept: { id: "p1", name: "Sarah K." } });
    expect(auditRows().every((row) => row.ipAddress === "203.0.113.9")).toBe(true);
    expect(db.salesPerson.updateMany.mock.calls[1][0]).toEqual({
      where: { id: "p2", archivedAt: null, mergedIntoId: null },
      data: { archivedAt: expect.any(Date), mergedIntoId: "p1" },
    });
  });

  it("merges organizations under organizations/", async () => {
    requireSalesUserMock.mockResolvedValue(admin);
    const res = await postMerge("organizations", "o1", { dropId: "o2" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kept: { id: "o1", name: "Oak Creek Dental" } });
  });

  it("refuses a request from another site and writes nothing", async () => {
    requireSalesUserMock.mockResolvedValue(admin);
    const res = await postMerge("people", "p1", { dropId: "p2" }, { origin: "https://evil.example", host: "localhost" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it.each([
    ["an unknown key", { dropId: "p2", force: true }],
    ["no dropId", {}],
    ["an empty dropId", { dropId: "" }],
    ["a dropId over 64 characters", { dropId: "x".repeat(65) }],
  ])("refuses %s as invalid input", async (_case, body) => {
    requireSalesUserMock.mockResolvedValue(admin);
    const res = await postMerge("people", "p1", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input." });
    expect(writes()).toEqual([]);
  });

  it("refuses a non-admin", async () => {
    requireSalesUserMock.mockResolvedValue(seesAll);
    const res = await postMerge("people", "p1", { dropId: "p2" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ONLY_ADMIN });
    expect(writes()).toEqual([]);
  });

  it("answers 409 when the merge loses twice", async () => {
    requireSalesUserMock.mockResolvedValue(admin);
    state.raced = { p2: 2 };
    const res = await postMerge("people", "p1", { dropId: "p2" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: JUST_CHANGED });
  });
});
