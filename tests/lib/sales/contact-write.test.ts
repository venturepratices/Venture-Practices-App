import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { SalesActor } from "@/lib/sales/access";

// The one way Sales picks or adds an organization and a person (Add deal now;
// new lead, convert and contact edits later): who may pick which contact
// (Decision 18), the keys a new contact is stored with (Decision 17), and its
// history row. Run against a fake transaction whose delegates record every call.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { checkContactRefs, contactRefSchema, createContacts, resolveContacts } = await import("@/lib/sales/contact-write");
const { canEditContact, visibleOrganizationWhere, visiblePersonWhere } = await import("@/lib/sales/contact-access");

type Row = Record<string, unknown>;
type Args = { where: Row; data: Row; select?: Row };

const seeOwn: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "s", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };

const META = { ipAddress: "203.0.113.9", userAgent: null };

/** What a see-own person may pick: their own contacts, or ones on their own live deals or leads. */
const SEE_OWN_WHERE = {
  archivedAt: null,
  OR: [
    { ownerId: "r" },
    { deals: { some: { ownerId: "r", archivedAt: null } } },
    { leads: { some: { ownerId: "r", archivedAt: null } } },
  ],
};

const audits: Row[] = [];
const visible = { organizations: new Map<string, Row>(), people: new Map<string, Row>() };

const tx = {
  salesOrganization: {
    findFirst: vi.fn(async (args: Args) => visible.organizations.get(args.where.id as string) ?? null),
    create: vi.fn(async (args: Args) => ({ id: "org-new", name: args.data.name })),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  salesPerson: {
    findFirst: vi.fn(async (args: Args) => visible.people.get(args.where.id as string) ?? null),
    create: vi.fn(async (args: Args) => ({ id: "person-new", name: args.data.name })),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => void audits.push(args.data)) },
};
const db = tx as never;

const creates = () => [...tx.salesOrganization.create.mock.calls, ...tx.salesPerson.create.mock.calls];

beforeEach(() => {
  for (const delegate of Object.values(tx)) for (const fn of Object.values(delegate)) fn.mockClear();
  audits.length = 0;
  visible.organizations = new Map([["o1", { id: "o1", name: "Bright Smiles Dental" }]]);
  visible.people = new Map([["p1", { id: "p1", name: "Dana W." }]]);
});

describe("checkContactRefs and resolveContacts", () => {
  it("refuses a picked organization the person cannot see", async () => {
    const result = await resolveContacts(db, seeOwn, { organization: { id: "o9" }, person: null }, "r", META);

    expect(result).toEqual({ ok: false, status: 400, error: "That organization was not found." });
    expect(tx.salesOrganization.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.salesOrganization.findFirst.mock.calls[0][0]).toEqual({
      where: { id: "o9", ...SEE_OWN_WHERE },
      select: { id: true, name: true },
    });
    expect(creates()).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("creates new contacts with their keys and history", async () => {
    const result = await resolveContacts(
      db,
      admin,
      { organization: { name: "Oak Creek Dental" }, person: { name: "Sarah K." } },
      "b",
      META,
    );

    expect(result).toEqual({
      ok: true,
      organization: { id: "org-new", name: "Oak Creek Dental" },
      person: { id: "person-new", name: "Sarah K." },
    });
    expect(tx.salesOrganization.create.mock.calls[0][0]).toEqual({
      data: { name: "Oak Creek Dental", ownerId: "b", nameKey: "oakcreekdental" },
      select: { id: true, name: true },
    });
    expect(tx.salesPerson.create.mock.calls[0][0]).toEqual({
      data: { name: "Sarah K.", ownerId: "b", organizationId: "org-new", nameKey: "sarahk", emailKey: null, phoneKey: null },
      select: { id: true, name: true },
    });
    // Keys never go in history.
    expect(audits.map((row) => [row.entityType, row.entityId, row.action, row.after])).toEqual([
      ["SalesOrganization", "org-new", "created", { name: "Oak Creek Dental", ownerId: "b" }],
      ["SalesPerson", "person-new", "created", { name: "Sarah K.", ownerId: "b", organizationId: "org-new" }],
    ]);
    for (const row of audits) expect(row).toMatchObject({ actorType: "USER", actorId: "z", ipAddress: "203.0.113.9" });
  });

  it("puts a new person in a picked organization", async () => {
    const result = await resolveContacts(db, seeOwn, { organization: { id: "o1" }, person: { name: "Sarah K." } }, "r", META);

    expect(result).toEqual({
      ok: true,
      organization: { id: "o1", name: "Bright Smiles Dental" },
      person: { id: "person-new", name: "Sarah K." },
    });
    expect(tx.salesOrganization.create).not.toHaveBeenCalled();
    expect(tx.salesPerson.create.mock.calls[0][0].data).toEqual({
      name: "Sarah K.",
      ownerId: "r",
      organizationId: "o1",
      nameKey: "sarahk",
      emailKey: null,
      phoneKey: null,
    });
    expect(audits.map((row) => [row.entityType, row.action])).toEqual([["SalesPerson", "created"]]);
  });

  it("never moves a picked person into a new organization", async () => {
    const result = await resolveContacts(db, seeOwn, { organization: { name: "New Practice" }, person: { id: "p1" } }, "r", META);

    expect(result).toEqual({
      ok: true,
      organization: { id: "org-new", name: "New Practice" },
      person: { id: "p1", name: "Dana W." },
    });
    expect(tx.salesPerson.create).not.toHaveBeenCalled();
    expect(tx.salesPerson.update).not.toHaveBeenCalled();
    expect(tx.salesPerson.updateMany).not.toHaveBeenCalled();
    expect(audits.map((row) => [row.entityType, row.action])).toEqual([["SalesOrganization", "created"]]);
  });

  it("checks every picked contact before making a new one", async () => {
    const result = await resolveContacts(db, seeOwn, { organization: { name: "New Practice" }, person: { id: "p9" } }, "r", META);

    expect(result).toEqual({ ok: false, status: 400, error: "That person was not found." });
    expect(tx.salesPerson.findFirst.mock.calls[0][0]).toEqual({
      where: { id: "p9", ...SEE_OWN_WHERE },
      select: { id: true, name: true },
    });
    expect(tx.salesOrganization.create).not.toHaveBeenCalled();
    expect(audits).toEqual([]);

    // The check alone only reads, even when every contact is new.
    const checked = await checkContactRefs(db, seeOwn, {
      organization: { name: "New Practice" },
      person: { name: "Sarah K." },
    });
    expect(checked).toEqual({ ok: true, picked: { organization: null, person: null } });
    expect(creates()).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("returns both picked contacts once both are found", async () => {
    const checked = await checkContactRefs(db, seeOwn, { organization: { id: "o1" }, person: { id: "p1" } });

    expect(checked).toEqual({
      ok: true,
      picked: { organization: { id: "o1", name: "Bright Smiles Dental" }, person: { id: "p1", name: "Dana W." } },
    });
    expect(creates()).toEqual([]);
  });

  it("neither contact is fine here", async () => {
    const result = await resolveContacts(db, seeOwn, { organization: null, person: null }, "r", META);

    expect(result).toEqual({ ok: true, organization: null, person: null });
    expect(tx.salesOrganization.findFirst).not.toHaveBeenCalled();
    expect(tx.salesPerson.findFirst).not.toHaveBeenCalled();
    expect(creates()).toEqual([]);
  });

  it("creates only what the input names, after a separate check", async () => {
    const input = { organization: { id: "o1" }, person: { name: "Mark T." } };
    const checked = await checkContactRefs(db, seeOwn, input);
    if (!checked.ok) throw new Error("expected the check to pass");

    const made = await createContacts(db, seeOwn, input, checked.picked, "r", META);

    expect(made).toEqual({ organization: { id: "o1", name: "Bright Smiles Dental" }, person: { id: "person-new", name: "Mark T." } });
    expect(tx.salesPerson.create.mock.calls[0][0].data).toMatchObject({ organizationId: "o1", nameKey: "markt" });
  });
});

describe("contact visibility", () => {
  it("contact visibility shapes", () => {
    for (const where of [visiblePersonWhere, visibleOrganizationWhere]) {
      expect(where(seeOwn, "mine")).toEqual({ archivedAt: null, ownerId: "r" });
      expect(where(admin, "mine")).toEqual({ archivedAt: null, ownerId: "z" });
      expect(where(seesAll, "mine")).toEqual({ archivedAt: null, ownerId: "s" });
      expect(where(seesAll, "everyone")).toEqual({ archivedAt: null });
      expect(where(admin, "everyone")).toEqual({ archivedAt: null });
      expect(where(seeOwn, "everyone")).toEqual(SEE_OWN_WHERE);
    }
  });

  it("only the contact's owner or an admin edits it", () => {
    expect(canEditContact(seeOwn, { ownerId: "r" })).toBe(true);
    expect(canEditContact(seeOwn, { ownerId: "b" })).toBe(false);
    expect(canEditContact(seesAll, { ownerId: "b" })).toBe(false);
    expect(canEditContact(admin, { ownerId: "b" })).toBe(true);
  });
});

describe("contactRefSchema", () => {
  it("update schemas leave out what was not sent", () => {
    const update = z.strictObject({ title: z.string().optional(), organization: contactRefSchema.optional() });

    const parsed = update.parse({ title: "x" });
    expect(parsed).toEqual({ title: "x" });
    expect("organization" in parsed).toBe(false);
    expect(update.parse({ organization: null })).toEqual({ organization: null });
  });

  it("create schemas fill in null, trim names and refuse anything else", () => {
    const create = z.strictObject({ organization: contactRefSchema.default(null), person: contactRefSchema.default(null) });

    expect(create.parse({})).toEqual({ organization: null, person: null });
    expect(create.parse({ person: { name: "  Sarah K. " } })).toEqual({ organization: null, person: { name: "Sarah K." } });
    expect(create.safeParse({ person: { name: "   " } }).success).toBe(false);
    expect(create.safeParse({ person: { name: "x".repeat(201) } }).success).toBe(false);
    expect(create.safeParse({ person: { id: "" } }).success).toBe(false);
    expect(create.safeParse({ person: { id: "x".repeat(65) } }).success).toBe(false);
    expect(create.safeParse({ person: { id: "p1", name: "Sarah K." } }).success).toBe(false);
  });
});
