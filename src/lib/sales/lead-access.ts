import type { Prisma } from "@/generated/prisma/client";
import { canEditDeal, dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import { fail, type SalesFail } from "@/lib/sales/http";

// The two questions every lead read and write asks first, the same as for
// deals (deal-access.ts): may this person see the lead at all, and may they
// change it. A lead someone may not see is "not found" everywhere (spec 18.3),
// so its existence is never confirmed. A deleted lead (`archivedAt` set) is
// gone; an archived one (status ARCHIVED) still opens, read-only, with Restore.

export const LEAD_NOT_FOUND = "Lead not found.";
export const NOT_YOUR_LEAD = "Only the lead owner or an admin can change this lead.";
export const LEAD_CONVERTED = "This lead was converted. Open its deal instead.";
export const LEAD_ARCHIVED = "This lead is archived. Restore it first.";

/** `where` for one lead this person may see: not deleted, and theirs unless they see everyone's. */
export function visibleLeadWhere(actor: SalesActor, leadId: string): Prisma.SalesLeadWhereInput {
  return { id: leadId, archivedAt: null, ...dealOwnerWhere(actor, "everyone") };
}

/**
 * Loads a lead for a change, inside the caller's transaction. 404 when the
 * person may not see it (or it is deleted or missing), 403 when they may see
 * it but not change it. `select` must include `ownerId` for the edit check.
 */
export async function findLeadForEdit<S extends Prisma.SalesLeadSelect & { ownerId: true }>(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  leadId: string,
  select: S,
): Promise<{ ok: true; lead: Prisma.SalesLeadGetPayload<{ select: S }> } | SalesFail> {
  const lead = await tx.salesLead.findFirst({ where: visibleLeadWhere(actor, leadId), select });
  if (!lead) return fail(404, LEAD_NOT_FOUND);
  if (!canEditDeal(actor, lead as { ownerId: string })) return fail(403, NOT_YOUR_LEAD);
  return { ok: true, lead: lead as Prisma.SalesLeadGetPayload<{ select: S }> };
}
