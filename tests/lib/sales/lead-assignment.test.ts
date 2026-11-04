import { describe, expect, it, vi } from "vitest";

// assignLeadOwner takes the transaction as an argument, so the tests hand it a
// small fake database that behaves like the real one where it matters: the
// cursor bump is one atomic step, and member lookups honour the `where` they get.
// The default `prisma` import is mocked only so loading the modules stays inert.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { assignLeadOwner, nextInRotation } = await import("@/lib/sales/lead-assignment");

type Member = { id: string; isAdmin: boolean; canUseSales: boolean; createdAt: Date };
type Settings = {
  leadAssignMode: "ROUND_ROBIN" | "SINGLE";
  // null is what a row made without a list used to store in the database.
  roundRobinMemberIds: string[] | null;
  singleAssigneeId: string | null;
  rrCursor: number;
};
type Where = { id?: string | { in: string[] }; isAdmin?: boolean; OR?: Record<string, unknown>[] };

const day = (n: number) => new Date(Date.UTC(2026, 0, n));
const salesMember = (id: string, extra: Partial<Member> = {}): Member => ({
  id,
  isAdmin: false,
  canUseSales: true,
  createdAt: day(10),
  ...extra,
});
const lostAccess = (id: string): Member => salesMember(id, { canUseSales: false });
const admin = (id: string, createdAt: Date): Member => ({ id, isAdmin: true, canUseSales: false, createdAt });

function matches(member: Member, where: Where): boolean {
  if (typeof where.id === "string" && member.id !== where.id) return false;
  if (typeof where.id === "object" && !where.id.in.includes(member.id)) return false;
  if (where.isAdmin !== undefined && member.isAdmin !== where.isAdmin) return false;
  if (where.OR && !where.OR.some((cond) => Object.entries(cond).every(([k, v]) => member[k as keyof Member] === v))) {
    return false;
  }
  return true;
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
  const settingsFindUnique = vi.fn(async (args: { where: { id: string } }) =>
    settings && args.where.id === "singleton"
      ? { leadAssignMode: settings.leadAssignMode, singleAssigneeId: settings.singleAssigneeId }
      : null,
  );
  const memberFindMany = vi.fn(async (args: { where: Where }) =>
    input.members.filter((m) => matches(m, args.where)).map((m) => ({ id: m.id })),
  );
  const memberFindFirst = vi.fn(async (args: { where: Where; orderBy?: unknown }) => {
    const found = input.members
      .filter((m) => matches(m, args.where))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return found[0] ? { id: found[0].id } : null;
  });

  const tx = {
    $queryRaw: queryRaw,
    salesSettings: { findUnique: settingsFindUnique },
    teamMember: { findMany: memberFindMany, findFirst: memberFindFirst },
  };
  return { tx: tx as never, settings, sql, queryRaw, memberFindMany };
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
    expect(memberFindMany.mock.calls[0][0].where).toEqual({
      id: { in: ["b", "r"] },
      OR: [{ isAdmin: true }, { canUseSales: true }],
    });
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
