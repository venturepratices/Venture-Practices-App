import { beforeEach, describe, expect, it, vi } from "vitest";

// The organization and person search behind the Add deal dialog's pickers: the
// who-can-see filter, the size limit, and no contact details in what comes back.
// Run against a fake database that records every call, and a fake Sales gate.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;

const db = {
  salesOrganization: {
    findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => [{ id: "o1", name: "Bright Smiles Dental" }]),
  },
  salesPerson: {
    findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => [
      { id: "pe1", name: "Brenda L.", organization: { name: "Bright Smiles Dental" } },
      { id: "pe2", name: "Brian M.", organization: null },
    ]),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { searchContacts } = await import("@/lib/sales/contacts");
const contactsRoute = await import("@/app/api/sales/contacts/route");
const { PermissionError } = await import("@/lib/permissions");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };

/** Contacts a see-own person may find: their own, or ones on their own live deals or leads (Decision 18). */
const SEE_OWN_OR = [
  { ownerId: "r" },
  { deals: { some: { ownerId: "r", archivedAt: null } } },
  { leads: { some: { ownerId: "r", archivedAt: null } } },
];

beforeEach(() => {
  db.salesOrganization.findMany.mockClear();
  db.salesPerson.findMany.mockClear();
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

describe("searchContacts", () => {
  it("searches organizations by name, limited to the ones they may see for someone set to their own deals", async () => {
    const results = await searchContacts(rep, "organization", "br", db as never);

    expect(results).toEqual([{ id: "o1", name: "Bright Smiles Dental" }]);
    expect(db.salesOrganization.findMany).toHaveBeenCalledWith({
      where: { archivedAt: null, OR: SEE_OWN_OR, name: { contains: "br", mode: "insensitive" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 8,
    });
  });

  it("searches everyone's for an admin", async () => {
    await searchContacts(admin, "organization", "br", db as never);

    expect(db.salesOrganization.findMany.mock.calls[0][0].where).toEqual({
      archivedAt: null,
      name: { contains: "br", mode: "insensitive" },
    });
  });

  it("searches people with their organization name, never their email or phone", async () => {
    const results = await searchContacts(rep, "person", "  bri ", db as never);

    expect(results).toEqual([
      { id: "pe1", name: "Brenda L.", organizationName: "Bright Smiles Dental" },
      { id: "pe2", name: "Brian M.", organizationName: null },
    ]);
    const args = db.salesPerson.findMany.mock.calls[0][0];
    expect(args).toEqual({
      where: { archivedAt: null, OR: SEE_OWN_OR, name: { contains: "bri", mode: "insensitive" } },
      select: { id: true, name: true, organization: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: 8,
    });
    expect(JSON.stringify(args.select)).not.toMatch(/email|phone/);
  });

  it("returns nothing without a query for a search under two letters", async () => {
    expect(await searchContacts(rep, "organization", "b", db as never)).toEqual([]);
    expect(await searchContacts(rep, "person", "  ", db as never)).toEqual([]);
    expect(db.salesOrganization.findMany).not.toHaveBeenCalled();
    expect(db.salesPerson.findMany).not.toHaveBeenCalled();
  });

  it("caps a very long search at 100 characters", async () => {
    await searchContacts(rep, "organization", "x".repeat(150), db as never);

    expect(db.salesOrganization.findMany.mock.calls[0][0].where.name).toEqual({ contains: "x".repeat(100), mode: "insensitive" });
  });
});

describe("GET /api/sales/contacts", () => {
  const get = (search: string) => contactsRoute.GET(new Request(`http://localhost/api/sales/contacts?${search}`));

  it("answers with the results", async () => {
    const res = await get("kind=organization&q=br");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ id: "o1", name: "Bright Smiles Dental" }] });
    expect(db.salesOrganization.findMany.mock.calls[0][0].where.OR).toEqual(SEE_OWN_OR);
  });

  it("refuses a kind that is not organization or person", async () => {
    const res = await get("kind=deals&q=br");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input." });
    expect(db.salesOrganization.findMany).not.toHaveBeenCalled();
    expect(db.salesPerson.findMany).not.toHaveBeenCalled();
  });

  it("refuses someone without Sales access and searches nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await get("kind=person&q=br");

    expect(res.status).toBe(403);
    expect(db.salesPerson.findMany).not.toHaveBeenCalled();
  });
});
