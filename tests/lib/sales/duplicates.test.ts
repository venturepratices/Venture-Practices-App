import { beforeEach, describe, expect, it, vi } from "vitest";

// Possible duplicates for the contact panel's warn bar (Decision 17, A4): who
// matches by the stored keys, the five a person may see by name, and whether a
// match they may not see exists (a plain line, never its name). Run with a fake
// database; nothing here reaches a real one.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;

const { findPersonDuplicates, findOrganizationDuplicates } = await import("@/lib/sales/duplicates");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "s", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "b", isAdmin: true, seesAllDeals: true, via: "user" };

// What a see-own rep ("r") may see, written out by hand (Decision 18).
const REP_VISIBLE = {
  archivedAt: null,
  OR: [
    { ownerId: "r" },
    { deals: { some: { ownerId: "r", archivedAt: null } } },
    { leads: { some: { ownerId: "r", archivedAt: null } } },
  ],
};
const ALL_VISIBLE = { archivedAt: null };

const state = { visible: [] as Row[], hidden: null as Row | null };

function fakeDb() {
  const delegate = () => ({
    findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => state.visible),
    findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => state.hidden),
  });
  return { salesPerson: delegate(), salesOrganization: delegate() };
}

beforeEach(() => {
  state.visible = [];
  state.hidden = null;
});

const sarah = { id: "p1", emailKey: "sarah@oak.example", phoneKey: "5125550142", nameKey: "sarahk", organizationId: "o1" };
const PERSON_MATCH = {
  id: { not: "p1" },
  archivedAt: null,
  OR: [{ emailKey: "sarah@oak.example" }, { phoneKey: "5125550142" }, { nameKey: "sarahk", organizationId: "o1" }],
};

describe("findPersonDuplicates", () => {
  it("finds people with the same email, phone, or name in the same practice", async () => {
    state.visible = [{ id: "p2", name: "Sarah Example" }];
    const db = fakeDb();
    const result = await findPersonDuplicates(db as never, rep, sarah);

    expect(db.salesPerson.findMany).toHaveBeenCalledTimes(1);
    expect(db.salesPerson.findMany.mock.calls[0][0]).toEqual({
      where: { AND: [PERSON_MATCH, REP_VISIBLE] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 5,
    });
    expect(result).toEqual({ matches: [{ id: "p2", name: "Sarah Example" }], hiddenMatch: false });
    expect(db.salesOrganization.findMany).not.toHaveBeenCalled();
  });

  it("leaves out keys it does not have", async () => {
    const db = fakeDb();
    await findPersonDuplicates(db as never, rep, { ...sarah, organizationId: null });
    expect(db.salesPerson.findMany.mock.calls[0][0].where).toEqual({
      AND: [{ id: { not: "p1" }, archivedAt: null, OR: [{ emailKey: "sarah@oak.example" }, { phoneKey: "5125550142" }] }, REP_VISIBLE],
    });

    await findPersonDuplicates(db as never, rep, { ...sarah, emailKey: null, phoneKey: null });
    expect(db.salesPerson.findMany.mock.calls[1][0].where).toEqual({
      AND: [{ id: { not: "p1" }, archivedAt: null, OR: [{ nameKey: "sarahk", organizationId: "o1" }] }, REP_VISIBLE],
    });

    // No key and no organization: nothing to match on, so nothing is read.
    const empty = fakeDb();
    const result = await findPersonDuplicates(empty as never, rep, {
      id: "p1",
      emailKey: null,
      phoneKey: null,
      nameKey: null,
      organizationId: null,
    });
    expect(result).toEqual({ matches: [], hiddenMatch: false });
    expect(empty.salesPerson.findMany).not.toHaveBeenCalled();
    expect(empty.salesPerson.findFirst).not.toHaveBeenCalled();

    // A name with no organization matches nothing either.
    const nameOnly = fakeDb();
    await findPersonDuplicates(nameOnly as never, rep, { id: "p1", emailKey: null, phoneKey: null, nameKey: "sarahk", organizationId: null });
    expect(nameOnly.salesPerson.findMany).not.toHaveBeenCalled();
  });

  it("hides other reps' matches behind a plain line, exactly", async () => {
    const db = fakeDb();
    state.visible = [{ id: "p2", name: "Sarah Example" }];
    state.hidden = { id: "p3" };
    const result = await findPersonDuplicates(db as never, rep, sarah);

    expect(db.salesPerson.findFirst).toHaveBeenCalledTimes(1);
    expect(db.salesPerson.findFirst.mock.calls[0][0]).toEqual({
      where: { AND: [PERSON_MATCH, { NOT: REP_VISIBLE }] },
      select: { id: true },
    });
    // The hidden match is never named: only that it exists.
    expect(result).toEqual({ matches: [{ id: "p2", name: "Sarah Example" }], hiddenMatch: true });

    state.visible = [];
    expect(await findPersonDuplicates(db as never, rep, sarah)).toEqual({ matches: [], hiddenMatch: true });

    state.hidden = null;
    expect(await findPersonDuplicates(db as never, rep, sarah)).toEqual({ matches: [], hiddenMatch: false });
  });

  it("never looks for a hidden match for someone who sees every contact", async () => {
    state.hidden = { id: "p3" };
    for (const actor of [admin, seesAll]) {
      const db = fakeDb();
      const result = await findPersonDuplicates(db as never, actor, sarah);

      expect(db.salesPerson.findFirst, actor.userId).not.toHaveBeenCalled();
      expect(db.salesPerson.findMany.mock.calls[0][0].where, actor.userId).toEqual({ AND: [PERSON_MATCH, ALL_VISIBLE] });
      expect(result.hiddenMatch, actor.userId).toBe(false);
    }
  });
});

const oak = { id: "o1", nameKey: "oakcreekdental", zip: "78704" };
const ORGANIZATION_MATCH = {
  id: { not: "o1" },
  archivedAt: null,
  nameKey: "oakcreekdental",
  OR: [{ zip: null }, { zip: "78704" }],
};

describe("findOrganizationDuplicates", () => {
  it("matches practices by name, and by ZIP when both have one", async () => {
    state.visible = [{ id: "o2", name: "Oak Creek Dental" }];
    const db = fakeDb();
    const result = await findOrganizationDuplicates(db as never, rep, oak);

    expect(db.salesOrganization.findMany.mock.calls[0][0]).toEqual({
      where: { AND: [ORGANIZATION_MATCH, REP_VISIBLE] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 5,
    });
    expect(result).toEqual({ matches: [{ id: "o2", name: "Oak Creek Dental" }], hiddenMatch: false });
    expect(db.salesPerson.findMany).not.toHaveBeenCalled();

    await findOrganizationDuplicates(db as never, rep, { ...oak, zip: null });
    expect(db.salesOrganization.findMany.mock.calls[1][0].where).toEqual({
      AND: [{ id: { not: "o1" }, archivedAt: null, nameKey: "oakcreekdental" }, REP_VISIBLE],
    });

    const noName = fakeDb();
    expect(await findOrganizationDuplicates(noName as never, rep, { ...oak, nameKey: null })).toEqual({
      matches: [],
      hiddenMatch: false,
    });
    expect(noName.salesOrganization.findMany).not.toHaveBeenCalled();
    expect(noName.salesOrganization.findFirst).not.toHaveBeenCalled();
  });

  it("hides other reps' matches behind a plain line, exactly", async () => {
    state.hidden = { id: "o3" };
    const db = fakeDb();
    const result = await findOrganizationDuplicates(db as never, rep, oak);

    expect(db.salesOrganization.findFirst.mock.calls[0][0]).toEqual({
      where: { AND: [ORGANIZATION_MATCH, { NOT: REP_VISIBLE }] },
      select: { id: true },
    });
    expect(result).toEqual({ matches: [], hiddenMatch: true });

    for (const actor of [admin, seesAll]) {
      const other = fakeDb();
      expect((await findOrganizationDuplicates(other as never, actor, oak)).hiddenMatch, actor.userId).toBe(false);
      expect(other.salesOrganization.findFirst, actor.userId).not.toHaveBeenCalled();
    }
  });
});
