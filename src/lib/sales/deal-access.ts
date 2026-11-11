import type { Prisma } from "@/generated/prisma/client";
import { canEditDeal, dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import { fail, type SalesFail } from "@/lib/sales/http";

// The two questions every deal read and write asks first: may this person see
// the deal at all, and may they change it. A deal someone may not see is
// "not found" everywhere (spec 18.3), so its existence is never confirmed.

export const DEAL_NOT_FOUND = "Deal not found.";
export const NOT_YOUR_DEAL = "Only the deal owner or an admin can change this deal.";

/** `where` for one deal this person may see: not archived, and theirs unless they see everyone's. */
export function visibleDealWhere(actor: SalesActor, dealId: string): Prisma.SalesDealWhereInput {
  return { id: dealId, archivedAt: null, ...dealOwnerWhere(actor, "everyone") };
}

/**
 * Loads a deal for a change, inside the caller's transaction. 404 when the
 * person may not see it (or it is archived or missing), 403 when they may see
 * it but not change it. `select` must include `ownerId` for the edit check.
 */
export async function findDealForEdit<S extends Prisma.SalesDealSelect & { ownerId: true }>(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  dealId: string,
  select: S,
): Promise<{ ok: true; deal: Prisma.SalesDealGetPayload<{ select: S }> } | SalesFail> {
  const deal = await tx.salesDeal.findFirst({ where: visibleDealWhere(actor, dealId), select });
  if (!deal) return fail(404, DEAL_NOT_FOUND);
  if (!canEditDeal(actor, deal as { ownerId: string })) return fail(403, NOT_YOUR_DEAL);
  return { ok: true, deal: deal as Prisma.SalesDealGetPayload<{ select: S }> };
}
