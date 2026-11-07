import { describe, expect, it, vi } from "vitest";

// assignLeadOwner takes the transaction as an argument, so the tests hand it a
// small fake database that behaves like the real one where it matters: the
// cursor bump is one atomic step, and member lookups honour the `where` they get.
// The default `prisma` import is mocked only so loading the modules stays inert.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { assignLeadOwner, loadAssignmentSummary, nextInRotation } = await import("@/lib/sales/lead-assignment");
const { SALES_MEMBER_WHERE } = await import("@/lib/sales/access");

type Member = { id: string; name: string; isAdmin: boolean; canUseSales: boolean; createdAt: Date };
type Settings = {
  leadAssignMode: "ROUND_ROBIN" | "SINGLE";
  // null is what a row made without a list used to store in the database.
  roundRobinMemberIds: string[] | null;
  singleAssigneeId: string | null;
  rrCursor: number;
};
type Where = { id?: string | { in: string[] }; isAdmin?: boolean; OR?: Record<string, unknown>[] };
type OrderBy = { createdAt?: "asc" | "desc"; id?: "asc" | "desc" }[];
type Select = Record<string, boolean>;

const day = (n: number) => new Date(Date.UTC(2026, 0, n));
const salesMember = (id: string, extra: Partial<Member> = {}): Member => ({
  id,
  name: `Member ${id.toUpperCase()}.`,
  isAdmin: false,
  canUseSales: true,
  createdAt: day(10),
  ...extra,
});
const lostAccess = (id: string, extra: Partial<Member> = {}): Member => salesMember(id, { canUseSales: false, ...extra });
const admin = (id: string, createdAt: Date, name = `Admin ${id.toUpperCase()}.`): Member => ({
  id,
  name,
  isAdmin: true,
  canUseSales: false,
  createdAt,
});

/** Like a Prisma `select`: only the columns asked for come back. */
function pick<T extends object>(row: T, select: Select | undefined): Partial<T> {
  if (!select) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => select[key])) as Partial<T>;
}

function matches(member: Member, where: Where): boolean {
  if (typeof where.id === "string" && member.id !== where.id) return false;
  if (typeof where.id === "object" && !where.id.in.includes(member.id)) return false;
  if (where.isAdmin !== undefined && member.isAdmin !== where.isAdmin) return false;
  if (where.OR && !where.OR.some((cond) => Object.entries(cond).every(([k, v]) => member[k as keyof Member] === v))) {
    return false;
  }
  return true;
}

/** Sorts like an ORDER BY over createdAt and id, clause by clause. */
function compareBy(orderBy: OrderBy) {
  return (a: Member, b: Member): number => {
    for (const clause of orderBy) {
      for (const [field, direction] of Object.entries(clause)) {
        const diff =
          field === "createdAt" ? a.createdAt.getTime() - b.createdAt.getTime() : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        if (diff !== 0) return direction === "desc" ? -diff : diff;
      }
    }
    return 0;
  };
}

function fakeTx(input: { settings: Partial<Settings> | null; members: Member[] }) {
  const settings: Settings | null = input.settings
    ? { leadAssignMode: "ROUND_ROBIN", roundRobinMemberIds: [], singleAssigneeId: null, rrCursor: 0, ...input.settings }
    : null;
  const sql: string[] = [];

  // One synchronous step per call, like a single UPDATE ... RETURNING: no two
  // callers can ever read the same cursor.
  const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
    sql.push(strings.join("?"));
    if (!settings) return [];
    settings.rrCursor += 1;
    return [{ rrCursor: settings.rrCursor, roundRobinMemberIds: settings.roundRobinMemberIds }];
  });
  const settingsFindUnique = vi.fn(async (args: { where: { id: string }; select?: Select }) =>
    settings && args.where.id === "singleton" ? pick(settings, args.select) : null,
  );
  const memberFindMany = vi.fn(async (args: { where: Where; select?: Select }) =>
    input.members.filter((m) => matches(m, args.where)).map((m) => pick(m, args.select)),
  );
  // Like the database: rows come back in no particular order (here, the order the
  // test listed them) unless the query asks for one with orderBy.
  const memberFindFirst = vi.fn(async (args: { where: Where; orderBy?: OrderBy; select?: Select }) => {
    const matching = input.members.filter((m) => matches(m, args.where));
    const found = args.orderBy ? [...matching].sort(compareBy(args.orderBy)) : matching;
    return found[0] ? pick(found[0], args.select) : null;
  });
  // Nothing in this module may write; these are here only so a test can prove that.
  const writes = {
    settingsUpdate: vi.fn(),
    settingsUpdateMany: vi.fn(),
    settingsUpsert: vi.fn(),
    memberUpdate: vi.fn(),
    memberUpdateMany: vi.fn(),
    executeRaw: vi.fn(),
  };

  const tx = {
    $queryRaw: queryRaw,
    $executeRaw: writes.executeRaw,
    salesSettings: {
      findUnique: settingsFindUnique,
      update: writes.settingsUpdate,
      updateMany: writes.settingsUpdateMany,
      upsert: writes.settingsUpsert,
    },
    teamMember: {
      findMany: memberFindMany,
      findFirst: memberFindFirst,
      update: writes.memberUpdate,
      updateMany: writes.memberUpdateMany,
    },
  };
  return { tx: tx as never, settings, sql, queryRaw, memberFindMany, writes };
}

describe("nextInRotation", () => {
  it("walks the list in order and wraps around", () => {
    expect(nextInRotation(["b", "r"], 0)).toEqual({ ownerId: "b", nextCursor: 1 });
    expect(nextInRotation(["b", "r"], 1)).toEqual({ ownerId: "r", nextCursor: 2 });
    expect(nextInRotation(["b", "r"], 2)).toEqual({ ownerId: "b", nextCursor: 3 });
  });

  it("returns null for an empty list", () => {
    expect(nextInRotation([], 0)).toBeNull();
    expect(nextInRotation([], 5)).toBeNull();
  });

  it("keeps working when the list is shorter than it used to be", () => {
    expect(nextInRotation(["b", "r", "s"], 7)?.ownerId).toBe("r");
    expect(nextInRotation(["b"], 41)?.ownerId).toBe("b");
  });

  it("treats a negative cursor as a position instead of crashing", () => {
    expect(nextInRotation(["b", "r"], -1)?.ownerId).toBe("r");
  });
});

describe("assignLeadOwner in round-robin mode", () => {
  const people = [salesMember("b"), salesMember("r"), salesMember("s")];

  it("gives two simultaneous leads different owners, in list order", async () => {
    const { tx, queryRaw } = fakeTx({ settings: { roundRobinMemberIds: ["b", "r"] }, members: people });

    const owners = await Promise.all([assignLeadOwner(tx), assignLeadOwner(tx)]);

    expect(owners).toEqual(["b", "r"]);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(await assignLeadOwner(tx)).toBe("b");
  });

  it("bumps the cursor with one atomic UPDATE ... RETURNING on the singleton row", async () => {
    const { tx, sql } = fakeTx({ settings: { roundRobinMemberIds: ["b", "r"] }, members: people });

    await assignLeadOwner(tx);

    expect(sql).toHaveLength(1);
    expect(sql[0].replace(/\s+/g, " ").trim()).toBe(
      `UPDATE "SalesSettings" SET "rrCursor" = "rrCursor" + 1 WHERE id = 'singleton' RETURNING "rrCursor", "roundRobinMemberIds"`,
    );
  });

  it("skips a member who lost Sales access and rotates over the rest", async () => {
    const { tx } = fakeTx({
      settings: { roundRobinMemberIds: ["gone", "b", "r"] },
      members: [lostAccess("gone"), ...people],
    });

    const owners = [await assignLeadOwner(tx), await assignLeadOwner(tx), await assignLeadOwner(tx)];

    expect(owners).toEqual(["b", "r", "b"]);
  });

  it("looks the members up in one query, with the shared Sales-member rule", async () => {
    const { tx, memberFindMany } = fakeTx({ settings: { roundRobinMemberIds: ["b", "r"] }, members: people });

    await assignLeadOwner(tx);

    expect(memberFindMany).toHaveBeenCalledTimes(1);
    expect(memberFindMany.mock.calls[0][0].where).toEqual({ id: { in: ["b", "r"] }, ...SALES_MEMBER_WHERE });
  });

  it("follows the saved list order, not the order the database returns people in", async () => {
    const { tx } = fakeTx({
      settings: { roundRobinMemberIds: ["r", "b"] },
      members: [salesMember("b"), salesMember("r")],
    });

    expect(await assignLeadOwner(tx)).toBe("r");
    expect(await assignLeadOwner(tx)).toBe("b");
  });

  it("counts an admin on the list as eligible even without the Sales switch", async () => {
    const { tx } = fakeTx({
      settings: { roundRobinMemberIds: ["boss", "b"] },
      members: [admin("boss", day(1)), salesMember("b")],
    });

    expect([await assignLeadOwner(tx), await assignLeadOwner(tx)]).toEqual(["boss", "b"]);
  });

  it("falls back to the first admin by creation date when nobody on the list is eligible", async () => {
    const { tx } = fakeTx({
      settings: { roundRobinMemberIds: ["gone"] },
      members: [lostAccess("gone"), admin("late", day(20)), admin("first", day(2)), salesMember("b")],
    });

    expect(await assignLeadOwner(tx)).toBe("first");
  });

  it("falls back to the first admin when the list is empty", async () => {
    const { tx } = fakeTx({ settings: { roundRobinMemberIds: [] }, members: [admin("first", day(2)), salesMember("b")] });

    expect(await assignLeadOwner(tx)).toBe("first");
  });

  it("falls back to the first admin when the saved list is NULL in the database", async () => {
    const { tx } = fakeTx({
      settings: { roundRobinMemberIds: null },
      members: [admin("late", day(20)), admin("first", day(2)), salesMember("b")],
    });

    expect(await assignLeadOwner(tx)).toBe("first");
  });

  it("falls back to the first admin when there is no settings row yet", async () => {
    const { tx } = fakeTx({ settings: null, members: [admin("late", day(20)), admin("first", day(2))] });

    expect(await assignLeadOwner(tx)).toBe("first");
  });

  it("throws a plain message when there is nobody at all to own the lead", async () => {
    const { tx } = fakeTx({ settings: null, members: [salesMember("b")] });

    await expect(assignLeadOwner(tx)).rejects.toThrow("No admin is available to own this lead.");
  });
});

describe("assignLeadOwner in single-person mode", () => {
  const members = [salesMember("b"), salesMember("r"), admin("first", day(2))];

  it("returns the chosen person without touching the cursor", async () => {
    const { tx, queryRaw, settings } = fakeTx({
      settings: { leadAssignMode: "SINGLE", singleAssigneeId: "r", roundRobinMemberIds: ["b", "r"] },
      members,
    });

    expect(await assignLeadOwner(tx)).toBe("r");
    expect(await assignLeadOwner(tx)).toBe("r");
    expect(queryRaw).not.toHaveBeenCalled();
    expect(settings?.rrCursor).toBe(0);
  });

  it("goes to the rotation when the chosen person lost Sales access", async () => {
    const { tx } = fakeTx({
      settings: { leadAssignMode: "SINGLE", singleAssigneeId: "gone", roundRobinMemberIds: ["b", "r"] },
      members: [lostAccess("gone"), ...members],
    });

    expect(await assignLeadOwner(tx)).toBe("b");
    expect(await assignLeadOwner(tx)).toBe("r");
  });

  it("goes to the rotation when no person was chosen", async () => {
    const { tx } = fakeTx({
      settings: { leadAssignMode: "SINGLE", singleAssigneeId: null, roundRobinMemberIds: ["r"] },
      members,
    });

    expect(await assignLeadOwner(tx)).toBe("r");
  });

  it("ends at the first admin when the chosen person is gone and the rotation list is NULL", async () => {
    const { tx } = fakeTx({
      settings: { leadAssignMode: "SINGLE", singleAssigneeId: "gone", roundRobinMemberIds: null },
      members,
    });

    expect(await assignLeadOwner(tx)).toBe("first");
  });

  it("ends at the first admin when the chosen person is gone and the rotation is empty", async () => {
    const { tx } = fakeTx({
      settings: { leadAssignMode: "SINGLE", singleAssigneeId: "gone", roundRobinMemberIds: [] },
      members,
    });

    expect(await assignLeadOwner(tx)).toBe("first");
  });
});

describe("loadAssignmentSummary", () => {
  // The Inbox footer and the settings card read this: what assignLeadOwner would
  // do right now, worked out from reads alone. It never moves the turn.
  const ben = (extra: Partial<Member> = {}) => salesMember("b", { name: "Ben Example", ...extra });
  const robert = salesMember("r", { name: "Robert O." });
  const firstAdmin = admin("first", day(2), "Dana Example");
  const laterAdmin = admin("late", day(20), "Laura B.");

  async function summarize(settings: Partial<Settings> | null, members: Member[]) {
    const fake = fakeTx({ settings, members });
    const summary = await loadAssignmentSummary(fake.tx);
    return { summary, ...fake };
  }

  function expectNoWrites(fake: Awaited<ReturnType<typeof summarize>>) {
    expect(fake.queryRaw).not.toHaveBeenCalled();
    for (const write of Object.values(fake.writes)) expect(write).not.toHaveBeenCalled();
    if (fake.settings) expect(fake.settings.rrCursor).toBe(0);
  }

  it("says who gets new leads without moving the turn", async () => {
    const noSettings = await summarize(null, [laterAdmin, firstAdmin, ben()]);
    expect(noSettings.summary).toEqual({ mode: "ROUND_ROBIN", names: [], fallbackName: "Dana E." });
    expectNoWrites(noSettings);

    // The database hands the people back as [r, b]; the saved order is [b, r].
    const rotation = await summarize({ roundRobinMemberIds: ["b", "r"] }, [robert, ben(), firstAdmin]);
    expect(rotation.summary).toEqual({ mode: "ROUND_ROBIN", names: ["Ben E.", "Robert O."], fallbackName: null });
    expectNoWrites(rotation);

    const oneLostAccess = await summarize(
      { roundRobinMemberIds: ["b", "x"] },
      [ben(), lostAccess("x", { name: "Mark T." }), firstAdmin],
    );
    expect(oneLostAccess.summary).toEqual({ mode: "ROUND_ROBIN", names: ["Ben E."], fallbackName: null });
    expectNoWrites(oneLostAccess);

    const single = await summarize(
      { leadAssignMode: "SINGLE", singleAssigneeId: "b", roundRobinMemberIds: ["r"] },
      [ben(), robert, firstAdmin],
    );
    expect(single.summary).toEqual({ mode: "SINGLE", names: ["Ben E."], fallbackName: null });
    expectNoWrites(single);

    const singleLostAccess = await summarize(
      { leadAssignMode: "SINGLE", singleAssigneeId: "b", roundRobinMemberIds: ["r"] },
      [ben({ canUseSales: false }), robert, firstAdmin],
    );
    expect(singleLostAccess.summary).toEqual({ mode: "ROUND_ROBIN", names: ["Robert O."], fallbackName: null });
    expectNoWrites(singleLostAccess);
  });

  it("names the first admin when nobody on the rotation can take a lead", async () => {
    const everyoneGone = await summarize(
      { roundRobinMemberIds: ["x"] },
      [lostAccess("x", { name: "Mark T." }), laterAdmin, firstAdmin],
    );
    expect(everyoneGone.summary).toEqual({ mode: "ROUND_ROBIN", names: [], fallbackName: "Dana E." });

    const nullList = await summarize({ roundRobinMemberIds: null }, [laterAdmin, firstAdmin]);
    expect(nullList.summary).toEqual({ mode: "ROUND_ROBIN", names: [], fallbackName: "Dana E." });

    const singleGoneNoRotation = await summarize(
      { leadAssignMode: "SINGLE", singleAssigneeId: "gone", roundRobinMemberIds: [] },
      [laterAdmin, firstAdmin],
    );
    expect(singleGoneNoRotation.summary).toEqual({ mode: "ROUND_ROBIN", names: [], fallbackName: "Dana E." });
  });

  it("gives no name at all when there is no admin either", async () => {
    const { summary } = await summarize(null, [ben()]);

    expect(summary).toEqual({ mode: "ROUND_ROBIN", names: [], fallbackName: null });
  });

  it("checks the rotation and the single person with the shared Sales-member rule", async () => {
    const rotation = await summarize({ roundRobinMemberIds: ["b", "r"] }, [ben(), robert]);
    expect(rotation.memberFindMany).toHaveBeenCalledTimes(1);
    expect(rotation.memberFindMany.mock.calls[0][0].where).toEqual({ id: { in: ["b", "r"] }, ...SALES_MEMBER_WHERE });
  });
});
