import type { Prisma } from "@/generated/prisma/client";
import type { SalesLeadStatus } from "@/generated/prisma/enums";
import type { SalesActor } from "@/lib/sales/access";
import { recordSalesAudit, type SalesRequestMeta, type SalesSystemActor } from "@/lib/sales/audit";
import type { ChildAuditEvent, ContactChange, FieldRef } from "@/lib/sales/deal-audit";

// Every change to a lead (the lead itself, its custom fields, the activities
// and notes on it) is written to the locked history log against the lead, the
// same way deal-audit.ts does for deals. The lead panel's History reads them
// back in timeline.ts. Dates are ISO strings, the form the Json column stores.

type Editable = { title: string; source: string };

export type LeadAuditEvent =
  | {
      action: "created";
      after: { title: string; ownerId: string; source: string; organizationId: string | null; personId: string | null };
    }
  /** Only the keys that changed. */
  | { action: "updated"; before: Partial<Editable>; after: Partial<Editable> }
  | {
      action: "owner_changed";
      before: { ownerId: string };
      /** `movedActivityIds` only when open activities moved to the new owner with the lead. */
      after: { ownerId: string; movedActivityIds?: string[] };
    }
  /** `merged` when the change came from merging duplicate contacts, not from someone editing this lead. */
  | { action: "contact_changed"; before: ContactChange; after: ContactChange & { merged?: true } }
  | { action: "field_changed"; before: FieldRef; after: FieldRef }
  /** Archive (to ARCHIVED) and Restore (back to OPEN). */
  | { action: "status_changed"; before: { status: SalesLeadStatus }; after: { status: SalesLeadStatus } }
  | { action: "converted"; after: { dealId: string } }
  /** Delete: the lead leaves every list for good (an admin only). */
  | { action: "archived"; before: { archivedAt: null }; after: { archivedAt: string } }
  /** No payload: the row itself (who, when, from where) is the record of the attempt. */
  | { action: "delete_refused" }
  | ChildAuditEvent;

/** One history row for a lead, inside the caller's transaction. Pass `requestMeta(request)` from a route. */
export async function recordLeadAudit(
  tx: Prisma.TransactionClient,
  actor: SalesActor | SalesSystemActor,
  leadId: string,
  event: LeadAuditEvent,
  meta?: Partial<SalesRequestMeta>,
): Promise<void> {
  await recordSalesAudit(
    tx,
    actor,
    {
      entityType: "SalesLead",
      entityId: leadId,
      action: event.action,
      before: "before" in event ? event.before : undefined,
      after: "after" in event ? event.after : undefined,
    },
    meta,
  );
}
