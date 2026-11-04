import type { Prisma } from "@/generated/prisma/client";
import { SALES_MEMBER_WHERE } from "@/lib/sales/access";

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
  const [row] = await tx.$queryRaw<{ rrCursor: number; roundRobinMemberIds: string[] }[]>`
    UPDATE "SalesSettings" SET "rrCursor" = "rrCursor" + 1 WHERE id = 'singleton'
    RETURNING "rrCursor", "roundRobinMemberIds"
  `;

  if (row && row.roundRobinMemberIds.length > 0) {
    const stillMembers = await tx.teamMember.findMany({
      where: { id: { in: row.roundRobinMemberIds }, ...SALES_MEMBER_WHERE },
      select: { id: true },
    });
    const allowed = new Set(stillMembers.map((member) => member.id));
    // Keep the saved order: the database does not return rows in list order.
    const eligible = row.roundRobinMemberIds.filter((id) => allowed.has(id));
    // The cursor was already moved up by one, so this lead's turn is the one before it.
    const next = nextInRotation(eligible, row.rrCursor - 1);
    if (next) return next.ownerId;
  }

  const firstAdmin = await tx.teamMember.findFirst({
    where: { isAdmin: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!firstAdmin) throw new Error("No admin is available to own this lead.");
  return firstAdmin.id;
}
