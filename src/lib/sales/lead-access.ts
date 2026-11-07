import type { Prisma } from "@/generated/prisma/client";
import type { SalesLeadStatus } from "@/generated/prisma/enums";
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
export const LEAD_JUST_CHANGED = "This lead just changed. Refresh and try again.";

/** A converted or archived lead takes no change but Restore and an admin's Delete (Decision 5). */
export function refuseUnlessOpen(status: SalesLeadStatus): SalesFail | null {
  if (status === "CONVERTED") return fail(409, LEAD_CONVERTED);
  if (status === "ARCHIVED") return fail(409, LEAD_ARCHIVED);
  return null;
}

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

/**
 * Loads an open lead for adding something to it (an activity or a note), inside
 * the caller's transaction, and takes its row with a guarded touch that repeats
 * the owner and status it read (Decision 10). The touch is the first write, so
 * a convert of the same lead running at the same moment either waits for this
 * transaction (and then moves what it added) or wins, in which case the touch
 * matches nothing and a fresh read refuses the converted lead. Losing twice
 * answers 409. Every refusal comes before any write.
 */
export async function takeOpenLead(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  leadId: string,
): Promise<{ ok: true; lead: { id: string; ownerId: string; personId: string | null } } | SalesFail> {
  for (let tries = 0; tries < 2; tries++) {
    const found = await findLeadForEdit(tx, actor, leadId, { id: true, ownerId: true, status: true, personId: true });
    if (!found.ok) return found;
    const { id, ownerId, status, personId } = found.lead;
    const closed = refuseUnlessOpen(status);
    if (closed) return closed;

    const { count } = await tx.salesLead.updateMany({
      where: { id, status: "OPEN", archivedAt: null, ownerId },
      data: { updatedAt: new Date() },
    });
    if (count > 0) return { ok: true, lead: { id, ownerId, personId } };
  }
  return fail(409, LEAD_JUST_CHANGED);
}
