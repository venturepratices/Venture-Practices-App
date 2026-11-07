import type { Prisma } from "@/generated/prisma/client";
import type { SalesActivityType, SalesDealStatus } from "@/generated/prisma/enums";
import type { SalesActor } from "@/lib/sales/access";
import { recordSalesAudit, type SalesRequestMeta, type SalesSystemActor } from "@/lib/sales/audit";

// Every deal-related change (the deal itself, its custom fields, the activities
// and notes on it) is written to the locked history log against the deal, with
// one of these typed actions. The deal panel's History reads them back in
// timeline.ts, so the payloads here are what that page can say. Dates are ISO
// strings, the form the Json column stores.

type StageRef = { stageId: string; stageName: string };
/**
 * The stage a deal left. A stage move also keeps when the deal had entered it
 * (ISO), so an Undo can put the days-in-stage clock back (stage-moves.ts).
 * Rows written before that, and the No Show rule's own moves (never undone
 * from a toast), leave it out.
 */
type LeftStage = StageRef & { stageEnteredAt?: string };
/**
 * The stage a deal went to. An Undo that put back when the deal had entered
 * that stage (stage-moves.ts) says so, with the time it put back, so the row is
 * never read as a move by hand. Every other move, the undo flag sent without a
 * time the server could put back included, is the plain reference.
 */
type EnteredStage = StageRef | (StageRef & { stageEnteredAt: string; undo: true });
type ActivityRef = { activityId: string; type: SalesActivityType; subject: string };
export type FieldRef = { fieldKey: string; label: string; value: string | null };
type Money = { valueCents: number; mrrCents: number };
type Editable = { title: string; source: string | null };

/** A deal's or lead's organization and person, with the names they had then, so History still reads after a rename. */
export type ContactChange = {
  organizationId: string | null;
  organizationName: string | null;
  personId: string | null;
  personName: string | null;
};

/** The activities and notes on a deal or a lead: the same rows, written against whichever the activity or note belongs to. */
export type ChildAuditEvent =
  | {
      action: "activity_added";
      after: { activityId: string; type: SalesActivityType; subject: string; dueAt: string; hasTime: boolean; createdBy: string };
    }
  | { action: "activity_done" | "activity_reopened" | "activity_missed"; after: ActivityRef }
  | { action: "activity_removed"; before: ActivityRef }
  | { action: "note_added"; after: { noteId: string } }
  /** Keeps the old text, so an edit never loses what the note said. */
  | { action: "note_edited"; before: { noteId: string; body: string }; after: { noteId: string; body: string } };

export type DealAuditEvent =
  | {
      action: "created";
      after: {
        title: string;
        pipelineId: string;
        stageId: string;
        stageName: string;
        ownerId: string;
        valueCents: number;
        mrrCents: number;
        organizationId: string | null;
        personId: string | null;
        source: string | null;
        /** A deal made by converting a lead (lead-convert.ts): the lead, and the open activities and notes that moved with it. */
        fromLeadId?: string;
        movedActivityIds?: string[];
        movedNoteIds?: string[];
      };
    }
  /** Only the keys that changed. */
  | { action: "updated"; before: Partial<Editable>; after: Partial<Editable> }
  | { action: "stage_changed"; before: LeftStage; after: EnteredStage }
  | {
      action: "status_changed";
      before: { status: SalesDealStatus };
      after: { status: SalesDealStatus; lostReason?: string; lostComment?: string };
    }
  | { action: "value_changed"; before: Money; after: Money }
  | {
      action: "owner_changed";
      before: { ownerId: string };
      /** `movedActivityIds` only when open activities moved to the new owner with the deal. */
      after: { ownerId: string; movedActivityIds?: string[] };
    }
  | { action: "field_changed"; before: FieldRef; after: FieldRef }
  /** `merged` when the change came from merging duplicate contacts, not from someone editing this deal. */
  | { action: "contact_changed"; before: ContactChange; after: ContactChange & { merged?: true } }
  | { action: "archived"; before: { archivedAt: null }; after: { archivedAt: string } }
  /** A final-version file added to the deal (files.ts), with the stage the deal was in. */
  | { action: "file_added"; after: { fileId: string; name: string; sizeBytes: number; stageName: string | null } }
  /** A file removed from the deal's Files list; the stored bytes stay. */
  | { action: "file_removed"; before: { fileId: string; name: string } }
  /** No payload: the row itself (who, when, from where) is the record of the attempt. */
  | { action: "delete_refused" }
  | ChildAuditEvent;

export type DealAuditAction = DealAuditEvent["action"];

/** One history row for a deal, inside the caller's transaction. Pass `requestMeta(request)` from a route. */
export async function recordDealAudit(
  tx: Prisma.TransactionClient,
  actor: SalesActor | SalesSystemActor,
  dealId: string,
  event: DealAuditEvent,
  meta?: Partial<SalesRequestMeta>,
): Promise<void> {
  await recordSalesAudit(
    tx,
    actor,
    {
      entityType: "SalesDeal",
      entityId: dealId,
      action: event.action,
      before: "before" in event ? event.before : undefined,
      after: "after" in event ? event.after : undefined,
    },
    meta,
  );
}
