import { beforeEach, describe, expect, it, vi } from "vitest";

// Adding and editing people and organizations through their routes (Task 10):
// who may change a contact (Decision 18), the duplicate keys every write
// recomputes (Decision 17), the guarded write that loses to a change made a
// moment earlier, and the history row each change writes. Run against a fake
// database whose delegates record every call, and a fake Sales gate. Nothing
// here reaches a real database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; data: Row; select?: Row };
type SalesActor = import("@/lib/sales/access").SalesActor;

/** A see-own rep (the plan's actor "r"), another see-own rep, a non-admin who sees everything, and an admin. */
const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const otherRep: SalesActor = { userId: "b", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "s", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };

/** When each contact was last saved, as the edit read it. */
const READ_AT = new Date("2026-11-04T15:00:00.000Z");

/** What a see-own rep "r" may see: their own contacts, or ones on their own live deals or leads. */
const SEE_OWN_R = {
  archivedAt: null,
  OR: [
    { ownerId: "r" },
    { deals: { some: { ownerId: "r", archivedAt: null } } },
    { leads: { some: { ownerId: "r", archivedAt: null } } },
  ],
};

const state = {
  people: [] as Row[],
  organizations: [] as Row[],
  /** How many guarded writes in a row match nothing, as if another request saved the contact first. */
  misses: 0,
  audits: [] as Row[],
};

const selected = (row: Row, select?: Row) =>
  select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row;

/** One branch of the see-own `OR`: owned by the person, or on one of their live deals or leads. */
const matchesBranch = (row: Row, branch: Row) => {
  if ("ownerId" in branch) return row.ownerId === branch.ownerId;
  const linked = (branch.deals ?? branch.leads) as { some: { ownerId: string; archivedAt: null } };
  const owners = (("deals" in branch ? row.dealOwnerIds : row.leadOwnerIds) ?? []) as string[];
  return linked.some.archivedAt === null && owners.includes(linked.some.ownerId);
};

const findContact = (rows: Row[], where: Row) =>
  rows.find(
    (row) =>
      row.id === where.id &&
      row.archivedAt === null &&
      (where.mergedIntoId === undefined || row.mergedIntoId === where.mergedIntoId) &&
      (where.ownerId === undefined || row.ownerId === where.ownerId) &&
      (where.OR === undefined || (where.OR as Row[]).some((branch) => matchesBranch(row, branch))),
  ) ?? null;

/** A guarded write: matches only the live, unmerged row saved exactly when it was read. */
const guardedUpdate = (rows: Row[], args: Args) => {
  if (state.misses > 0) {
    state.misses -= 1;
    return { count: 0 };
  }
  const row = rows.find(
    (candidate) =>
      candidate.id === args.where.id &&
      candidate.archivedAt === null &&
      candidate.mergedIntoId === null &&
      (candidate.updatedAt as Date).getTime() === (args.where.updatedAt as Date | undefined)?.getTime(),
  );
  return { count: row ? 1 : 0 };
};

const db = {
  salesOrganization: {
    findFirst: vi.fn(async (args: Args) => {
      const row = findContact(state.organizations, args.where);
      return row ? selected(row, args.select) : null;
    }),
    create: vi.fn(async (args: Args) => selected({ id: "org-new", ...args.data }, args.select)),
    updateMany: vi.fn(async (args: Args) => guardedUpdate(state.organizations, args)),
  },
  salesPerson: {
    findFirst: vi.fn(async (args: Args) => {
      const row = findContact(state.people, args.where);
      return row ? selected(row, args.select) : null;
    }),
    create: vi.fn(async (args: Args) => selected({ id: "person-new", ...args.data }, args.select)),
    updateMany: vi.fn(async (args: Args) => guardedUpdate(state.people, args)),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => void state.audits.push(args.data)) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const contactsRoute = await import("@/app/api/sales/contacts/[kind]/route");
const contactRoute = await import("@/app/api/sales/contacts/[kind]/[contactId]/route");
const { PermissionError } = await import("@/lib/permissions");

const BASE = "http://localhost/api/sales/contacts";
const HEADERS = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };

const post = (kind: string, body: unknown, headers: Record<string, string> = {}) =>
  contactsRoute.POST(
    new Request(`${BASE}/${kind}`, { method: "POST", body: JSON.stringify(body), headers: { ...HEADERS, ...headers } }),
    { params: Promise.resolve({ kind }) },
  );
const patch = (kind: string, contactId: string, body: unknown, headers: Record<string, string> = {}) =>
  contactRoute.PATCH(
    new Request(`${BASE}/${kind}/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { ...HEADERS, ...headers },
    }),
    { params: Promise.resolve({ kind, contactId }) },
  );

const asActor = (actor: SalesActor) => requireSalesUserMock.mockResolvedValue(actor);
const writes = () => [
  ...db.salesOrganization.create.mock.calls,
  ...db.salesOrganization.updateMany.mock.calls,
  ...db.salesPerson.create.mock.calls,
  ...db.salesPerson.updateMany.mock.calls,
  ...db.salesAuditLog.create.mock.calls,
];

const SARAH = {
  id: "p1",
  name: "Sarah Example",
  email: "Sarah@Oak.example",
  phone: "(512) 555-0142",
  role: "Office manager",
  organizationId: "o1",
  ownerId: "r",
  archivedAt: null,
  mergedIntoId: null,
  updatedAt: READ_AT,
};

beforeEach(() => {
  for (const delegate of Object.values(db)) {
    if (typeof delegate === "function") delegate.mockClear();
    else for (const fn of Object.values(delegate)) fn.mockClear();
  }
  state.people = [
    { ...SARAH },
    // Merged into p1: archived with the id it went to, so an edit through its old id finds nothing.
    { ...SARAH, id: "p-merged", name: "Sarah E.", ownerId: "b", archivedAt: READ_AT, mergedIntoId: "p1" },
  ];
  state.organizations = [
    {
      id: "o1",
      name: "Oak Creek Dental",
      phone: null,
      website: null,
      address: null,
      zip: "78704",
      ownerId: "r",
      archivedAt: null,
      mergedIntoId: null,
      updatedAt: READ_AT,
    },
    // Another rep's practice, on none of r's deals or leads: hidden from r.
    {
      id: "o9",
      name: "Lakeside Ortho",
      phone: null,
      website: null,
      address: null,
      zip: null,
      ownerId: "b",
      archivedAt: null,
      mergedIntoId: null,
      updatedAt: READ_AT,
      dealOwnerIds: ["b"],
    },
  ];
  state.misses = 0;
  state.audits = [];
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

describe("POST /api/sales/contacts/people", () => {
  it("adds a person with keys and history", async () => {
    const res = await post("people", {
      name: "Sarah Example",
      email: " Sarah@Oak.example ",
      phone: "(512) 555-0142",
      role: "Office manager",
      organization: { id: "o1" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ contact: { id: "person-new", name: "Sarah Example" } });
    expect(db.salesOrganization.findFirst.mock.calls[0][0]).toEqual({
      where: { id: "o1", ...SEE_OWN_R },
      select: { id: true, name: true },
    });
    expect(db.salesPerson.create.mock.calls).toEqual([
      [
        {
          data: {
            name: "Sarah Example",
            email: "Sarah@Oak.example",
            phone: "(512) 555-0142",
            role: "Office manager",
            organizationId: "o1",
            ownerId: "r",
            nameKey: "sarahexample",
            emailKey: "sarah@oak.example",
            phoneKey: "5125550142",
          },
          select: { id: true, name: true },
        },
      ],
    ]);
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesPerson",
        entityId: "person-new",
        action: "created",
        actorType: "USER",
        actorId: "r",
        after: { name: "Sarah Example", ownerId: "r", organizationId: "o1" },
        ipAddress: "203.0.113.9",
      }),
    ]);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("stores a name alone with empty details, and a blank detail as none", async () => {
    const res = await post("people", { name: "  Dana Q. ", email: "", phone: "  " });

    expect(res.status).toBe(201);
    expect(db.salesPerson.create.mock.calls[0][0].data).toEqual({
      name: "Dana Q.",
      email: null,
      phone: null,
      role: null,
      organizationId: null,
      ownerId: "r",
      nameKey: "danaq",
      emailKey: null,
      phoneKey: null,
    });
    expect(state.audits.map((row) => row.after)).toEqual([{ name: "Dana Q.", ownerId: "r", organizationId: null }]);
  });

  it("adds a new practice for the person first, owned by whoever adds them", async () => {
    asActor(admin);
    const res = await post("people", { name: "Mark T.", organization: { name: "New Practice" } });

    expect(res.status).toBe(201);
    expect(db.salesOrganization.create.mock.calls[0][0].data).toEqual({ name: "New Practice", ownerId: "z", nameKey: "newpractice" });
    expect(db.salesPerson.create.mock.calls[0][0].data).toMatchObject({ ownerId: "z", organizationId: "org-new" });
    expect(state.audits.map((row) => [row.entityType, row.entityId, row.action])).toEqual([
      ["SalesOrganization", "org-new", "created"],
      ["SalesPerson", "person-new", "created"],
    ]);
  });

  it.each([
    [{ name: "Sarah Example", email: "nope" }, "Enter a real email address."],
    [{ name: "" }, "Add a name."],
    [{ name: "   " }, "Add a name."],
    [{}, "Add a name."],
    [{ name: "x".repeat(201) }, "Keep the name under 200 characters."],
    [{ name: "Sarah Example", phone: "5".repeat(41) }, "Keep the phone number under 40 characters."],
    [{ name: "Sarah Example", role: "r".repeat(101) }, "Keep the role under 100 characters."],
  ])("refuses %j with %j and writes nothing", async (body, error) => {
    const res = await post("people", body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(writes()).toEqual([]);
  });

  it("refuses someone without Sales access, and an unknown kind, writing nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const denied = await post("people", { name: "Sarah Example" });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "You don't have access to Sales." });

    asActor(rep);
    const unknown = await post("widgets", { name: "Sarah Example" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Invalid input." });
    expect(writes()).toEqual([]);
  });

  it("blocks an add sent from another site", async () => {
    const res = await post("people", { name: "Sarah Example" }, { origin: "https://evil.example" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(writes()).toEqual([]);
  });
});

describe("a hidden organization is not found", () => {
  it("refuses a hidden organization when adding a person, writing nothing", async () => {
    const res = await post("people", { name: "Sarah Example", organization: { id: "o9" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That organization was not found." });
    expect(writes()).toEqual([]);
  });

  it("refuses a hidden organization when editing a person, writing nothing", async () => {
    const res = await patch("people", "p1", { organization: { id: "o9" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That organization was not found." });
    expect(writes()).toEqual([]);
  });
});

describe("PATCH /api/sales/contacts/people/[contactId]", () => {
  it("edits a person with a guarded write", async () => {
    const res = await patch("people", "p1", { phone: "512 555 0199" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: true, contact: { id: "p1", name: "Sarah Example" } });
    expect(db.salesPerson.findFirst.mock.calls[0][0].where).toEqual({ id: "p1", mergedIntoId: null, ...SEE_OWN_R });
    expect(db.salesPerson.updateMany.mock.calls).toEqual([
      [
        {
          where: { id: "p1", archivedAt: null, mergedIntoId: null, updatedAt: READ_AT },
          data: { phone: "512 555 0199", phoneKey: "5125550199" },
        },
      ],
    ]);
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesPerson",
        entityId: "p1",
        action: "updated",
        actorId: "r",
        before: { phone: "(512) 555-0142" },
        after: { phone: "512 555 0199" },
        ipAddress: "203.0.113.9",
      }),
    ]);
  });

  it("refuses someone who sees the person but does not own it, and hides a person they cannot see", async () => {
    asActor(seesAll);
    const notYours = await patch("people", "p1", { phone: "512 555 0199" });
    expect(notYours.status).toBe(403);
    expect(await notYours.json()).toEqual({ error: "Only the contact's owner or an admin can change this contact." });

    asActor(otherRep);
    const hidden = await patch("people", "p1", { phone: "512 555 0199" });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Contact not found." });

    const merged = await patch("people", "p-merged", { phone: "512 555 0199" });
    expect(merged.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  it("lets an admin edit another rep's person", async () => {
    asActor(admin);
    const res = await patch("people", "p1", { role: "Owner" });

    expect(res.status).toBe(200);
    expect(db.salesPerson.updateMany.mock.calls[0][0].data).toEqual({ role: "Owner" });
    expect(state.audits[0]).toMatchObject({ actorId: "z", before: { role: "Office manager" }, after: { role: "Owner" } });
  });

  it("answers changed: false with no write and no row when nothing changes", async () => {
    const res = await patch("people", "p1", { phone: "(512) 555-0142", organization: { id: "o1" }, name: " Sarah Example " });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: false, contact: { id: "p1", name: "Sarah Example" } });
    expect(writes()).toEqual([]);
  });

  it("answers 409 after losing the guarded write twice", async () => {
    state.misses = 2;
    const res = await patch("people", "p1", { phone: "512 555 0199" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This contact just changed. Refresh and try again." });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.salesPerson.updateMany).toHaveBeenCalledTimes(2);
    expect(state.audits).toEqual([]);
  });

  it("saves on the second try after losing once", async () => {
    state.misses = 1;
    const res = await patch("people", "p1", { phone: "512 555 0199" });

    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(state.audits.map((row) => row.action)).toEqual(["updated"]);
  });

  it("removes the organization", async () => {
    const res = await patch("people", "p1", { organization: null });

    expect(res.status).toBe(200);
    expect(db.salesPerson.updateMany.mock.calls[0][0].data).toEqual({ organizationId: null });
    expect(state.audits).toEqual([
      expect.objectContaining({ action: "updated", before: { organizationId: "o1" }, after: { organizationId: null } }),
    ]);
  });

  it("a phone-only edit keeps the organization", async () => {
    const res = await patch("people", "p1", { phone: "512 555 0199" });

    expect(res.status).toBe(200);
    expect(db.salesPerson.updateMany.mock.calls[0][0].data).not.toHaveProperty("organizationId");
    expect(db.salesOrganization.findFirst).not.toHaveBeenCalled();
  });

  it("recomputes the keys of the details that change, and clears a blank one", async () => {
    const res = await patch("people", "p1", { name: "Sarah K.", email: "" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: true, contact: { id: "p1", name: "Sarah K." } });
    expect(db.salesPerson.updateMany.mock.calls[0][0].data).toEqual({
      name: "Sarah K.",
      nameKey: "sarahk",
      email: null,
      emailKey: null,
    });
    expect(state.audits[0]).toMatchObject({
      before: { name: "Sarah Example", email: "Sarah@Oak.example" },
      after: { name: "Sarah K.", email: null },
    });
  });

  it("moves the person to a new practice owned by the person's owner, the practice's row first", async () => {
    asActor(admin);
    const res = await patch("people", "p1", { organization: { name: "New Practice" } });

    expect(res.status).toBe(200);
    expect(db.salesOrganization.create.mock.calls[0][0].data).toEqual({ name: "New Practice", ownerId: "r", nameKey: "newpractice" });
    expect(db.salesPerson.updateMany.mock.calls[0][0].data).toEqual({ organizationId: "org-new" });
    expect(state.audits.map((row) => [row.entityType, row.entityId, row.action])).toEqual([
      ["SalesOrganization", "org-new", "created"],
      ["SalesPerson", "p1", "updated"],
    ]);
    expect(state.audits[1]).toMatchObject({ before: { organizationId: "o1" }, after: { organizationId: "org-new" } });
  });

  it("a race after a new practice rolls back", async () => {
    state.misses = 2;
    const res = await patch("people", "p1", { organization: { name: "New Practice" } });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This contact just changed. Refresh and try again." });
    // Each try ran in its own transaction, and each one threw (rolling back its new practice and history row).
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.$transaction.mock.settledResults.map((result) => result.type)).toEqual(["rejected", "rejected"]);
    expect(db.salesOrganization.create).toHaveBeenCalledTimes(2);
  });

  it("needs something to change and refuses unknown keys", async () => {
    expect((await patch("people", "p1", {})).status).toBe(400);
    expect(await (await patch("people", "p1", {})).json()).toEqual({ error: "Nothing to change." });
    expect((await patch("people", "p1", { zip: "78704" })).status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("blocks an edit sent from another site", async () => {
    const res = await patch("people", "p1", { phone: "512 555 0199" }, { origin: "https://evil.example" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(db.salesPerson.findFirst).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});

describe("adds and edits a practice", () => {
  it("adds a practice with its website made into a link and its key", async () => {
    const res = await post("organizations", { name: "Oak Creek Dental", website: "oakcreekdental.com", zip: "78704" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ contact: { id: "org-new", name: "Oak Creek Dental" } });
    expect(db.salesOrganization.create.mock.calls).toEqual([
      [
        {
          data: {
            name: "Oak Creek Dental",
            phone: null,
            website: "https://oakcreekdental.com/",
            address: null,
            zip: "78704",
            ownerId: "r",
            nameKey: "oakcreekdental",
          },
          select: { id: true, name: true },
        },
      ],
    ]);
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesOrganization",
        entityId: "org-new",
        action: "created",
        actorId: "r",
        after: { name: "Oak Creek Dental", ownerId: "r" },
      }),
    ]);
  });

  it("saves a ZIP+4", async () => {
    const res = await post("organizations", { name: "Oak Creek Dental", zip: "78704-1234" });

    expect(res.status).toBe(201);
    expect(db.salesOrganization.create.mock.calls[0][0].data).toMatchObject({ zip: "78704-1234" });
  });

  it.each([
    [{ name: "Oak Creek Dental", website: "javascript:alert(1)" }, "Enter a web address like https://example.com."],
    [{ name: "Oak Creek Dental", zip: "7870" }, "Enter a 5-digit ZIP code."],
    [{ name: "Oak Creek Dental", address: "a".repeat(501) }, "Keep the address under 500 characters."],
    [{ name: "Oak Creek Dental", phone: "5".repeat(41) }, "Keep the phone number under 40 characters."],
    [{ name: "" }, "Add a name."],
  ])("refuses %j with %j and writes nothing", async (body, error) => {
    const res = await post("organizations", body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(writes()).toEqual([]);
  });

  it("refuses a person's key on a practice", async () => {
    const res = await post("organizations", { name: "Oak Creek Dental", role: "Office manager" });

    expect(res.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("edits a practice with a guarded write, its key only when the name changes", async () => {
    const zip = await patch("organizations", "o1", { zip: "78704-1234", website: "http://oak.example/path" });

    expect(zip.status).toBe(200);
    expect(await zip.json()).toEqual({ changed: true, contact: { id: "o1", name: "Oak Creek Dental" } });
    expect(db.salesOrganization.findFirst.mock.calls[0][0].where).toEqual({ id: "o1", mergedIntoId: null, ...SEE_OWN_R });
    expect(db.salesOrganization.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "o1", archivedAt: null, mergedIntoId: null, updatedAt: READ_AT },
      data: { zip: "78704-1234", website: "http://oak.example/path" },
    });
    expect(state.audits[0]).toMatchObject({
      entityType: "SalesOrganization",
      entityId: "o1",
      action: "updated",
      before: { zip: "78704", website: null },
      after: { zip: "78704-1234", website: "http://oak.example/path" },
    });

    const renamed = await patch("organizations", "o1", { name: "Oak-Creek Dental East" });
    expect(renamed.status).toBe(200);
    expect(db.salesOrganization.updateMany.mock.calls[1][0].data).toEqual({
      name: "Oak-Creek Dental East",
      nameKey: "oakcreekdentaleast",
    });
  });

  it("refuses a practice edit by a non-owner, a hidden practice, and a race lost twice", async () => {
    asActor(seesAll);
    expect((await patch("organizations", "o1", { zip: "78705" })).status).toBe(403);

    asActor(rep);
    const hidden = await patch("organizations", "o9", { zip: "78705" });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Contact not found." });

    state.misses = 2;
    const raced = await patch("organizations", "o1", { zip: "78705" });
    expect(raced.status).toBe(409);
    expect(await raced.json()).toEqual({ error: "This contact just changed. Refresh and try again." });
    expect(state.audits).toEqual([]);
  });

  it("answers changed: false when the practice already reads that way", async () => {
    const res = await patch("organizations", "o1", { zip: "78704", phone: null });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: false, contact: { id: "o1", name: "Oak Creek Dental" } });
    expect(writes()).toEqual([]);
  });
});
