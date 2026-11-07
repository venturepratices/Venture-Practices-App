import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { SALES_MEMBER_WHERE } from "@/lib/sales/access";
import { shortName } from "@/lib/sales/format";

/**
 * Who gets the next new lead, in words: the Inbox footer and the settings card
 * read it. SINGLE names the chosen person; ROUND_ROBIN names the people who
 * take turns, in the saved order; when nobody on either can take a lead,
 * `names` is empty and `fallbackName` is the first admin, who gets it instead.
 */
export type AssignmentSummary = { mode: "ROUND_ROBIN" | "SINGLE"; names: string[]; fallbackName: string | null };

/** Who "the first admin" is, wherever it is read (the fallback owner, the settings card), so every place names the same person. */
export const FIRST_ADMIN_ORDER: Prisma.TeamMemberOrderByWithRelationInput[] = [{ createdAt: "asc" }, { id: "asc" }];

/**
 * Who is next in a rotation. Skips nobody and wraps around; `cursor` only ever
 * counts up, so it may be larger than the list. Null when the list is empty.
 */
export function nextInRotation(memberIds: string[], cursor: number): { ownerId: string; nextCursor: number } | null {
  if (memberIds.length === 0) return null;
  const position = ((cursor % memberIds.length) + memberIds.length) % memberIds.length;
  return { ownerId: memberIds[position], nextCursor: cursor + 1 };
}

/**
 * Picks the owner for a new lead. Call it inside the transaction that creates
 * the lead, so the lead and the cursor move together.
 *
 * SINGLE mode: the chosen person, as long as they still have Sales access.
 * ROUND_ROBIN mode (also the way out of SINGLE when its person is gone): the
 * cursor moves up by one in a single UPDATE ... RETURNING, so two leads arriving
 * at once always get different cursors, then the saved list is narrowed to people
 * who still have Sales access and the lead goes to the one at that cursor.
 * With no settings yet, or nobody left on the list, the first admin gets it.
 */
export async function assignLeadOwner(tx: Prisma.TransactionClient): Promise<string> {
  const settings = await tx.salesSettings.findUnique({
    where: { id: "singleton" },
    select: { leadAssignMode: true, singleAssigneeId: true },
  });

  if (settings?.leadAssignMode === "SINGLE" && settings.singleAssigneeId) {
    const chosen = await tx.teamMember.findFirst({
      where: { id: settings.singleAssigneeId, ...SALES_MEMBER_WHERE },
      select: { id: true },
    });
    if (chosen) return chosen.id;
  }

  // The row lock this UPDATE takes is held until the caller's transaction ends,
  // which is what makes simultaneous leads take turns instead of sharing a cursor.
  const [row] = await tx.$queryRaw<{ rrCursor: number; roundRobinMemberIds: string[] | null }[]>`
    UPDATE "SalesSettings" SET "rrCursor" = "rrCursor" + 1 WHERE id = 'singleton'
    RETURNING "rrCursor", "roundRobinMemberIds"
  `;
  // A raw read hands back the column as stored, and an old row may hold NULL. Treat that as an empty list.
  const savedIds = row?.roundRobinMemberIds ?? [];

  if (row && savedIds.length > 0) {
    const stillMembers = await tx.teamMember.findMany({
      where: { id: { in: savedIds }, ...SALES_MEMBER_WHERE },
      select: { id: true },
    });
    const allowed = new Set(stillMembers.map((member) => member.id));
    // Keep the saved order: the database does not return rows in list order.
    const eligible = savedIds.filter((id) => allowed.has(id));
    // The cursor was already moved up by one, so this lead's turn is the one before it.
    const next = nextInRotation(eligible, row.rrCursor - 1);
    if (next) return next.ownerId;
  }

  const firstAdmin = await tx.teamMember.findFirst({
    where: { isAdmin: true },
    orderBy: FIRST_ADMIN_ORDER,
    select: { id: true },
  });
  if (!firstAdmin) throw new Error("No admin is available to own this lead.");
  return firstAdmin.id;
}

/**
 * What `assignLeadOwner` would do for a lead arriving now, read without moving
 * the turn: the same rules (the single person while they keep Sales access,
 * else the people on the rotation who still have it, in the saved order, else
 * the first admin), and only reads, so opening the Inbox never uses up a turn.
 */
export async function loadAssignmentSummary(
  db: Pick<typeof prisma, "salesSettings" | "teamMember"> = prisma,
): Promise<AssignmentSummary> {
  const settings = await db.salesSettings.findUnique({
    where: { id: "singleton" },
    select: { leadAssignMode: true, singleAssigneeId: true, roundRobinMemberIds: true },
  });

  if (settings?.leadAssignMode === "SINGLE" && settings.singleAssigneeId) {
    const chosen = await db.teamMember.findFirst({
      where: { id: settings.singleAssigneeId, ...SALES_MEMBER_WHERE },
      select: { name: true },
    });
    if (chosen) return { mode: "SINGLE", names: [shortName(chosen.name)], fallbackName: null };
  }

  // An old row may hold NULL for the list (see assignLeadOwner). Treat that as an empty list.
  const savedIds = settings?.roundRobinMemberIds ?? [];
  if (savedIds.length > 0) {
    const stillMembers = await db.teamMember.findMany({
      where: { id: { in: savedIds }, ...SALES_MEMBER_WHERE },
      select: { id: true, name: true },
    });
    const nameById = new Map(stillMembers.map((member) => [member.id, member.name]));
    // Keep the saved order: the database does not return rows in list order.
    const names = savedIds.flatMap((id) => {
      const name = nameById.get(id);
      return name === undefined ? [] : [shortName(name)];
    });
    if (names.length > 0) return { mode: "ROUND_ROBIN", names, fallbackName: null };
  }

  const firstAdmin = await db.teamMember.findFirst({
    where: { isAdmin: true },
    orderBy: FIRST_ADMIN_ORDER,
    select: { name: true },
  });
  return { mode: "ROUND_ROBIN", names: [], fallbackName: firstAdmin ? shortName(firstAdmin.name) : null };
}
