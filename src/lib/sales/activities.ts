import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canEditDeal, dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import type { SalesRequestMeta } from "@/lib/sales/audit";
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES, SUBJECT_MAX } from "@/lib/sales/constants";
import { findDealForEdit, NOT_YOUR_DEAL } from "@/lib/sales/deal-access";
import { recordDealAudit, type ChildAuditEvent } from "@/lib/sales/deal-audit";
import type { PanelActivity } from "@/lib/sales/deal-panel";
import { activityDueAt, isValidDateString } from "@/lib/sales/format";
import { fail, type SalesFail } from "@/lib/sales/http";
import { NOT_YOUR_LEAD, refuseUnlessOpen, takeOpenLead } from "@/lib/sales/lead-access";
import { recordLeadAudit } from "@/lib/sales/lead-audit";

// Scheduling an activity on a deal or a lead, and ticking one done (or back to
// open). Each change runs in one transaction with its history row, written
// against the deal, or against the lead while the activity has no deal. Only
// the owner of that deal or lead, or an admin, may do either (Decision 15). An
// activity is found only through a deal or lead this person may see, so one on
// a hidden, deleted or reassigned parent is "not found", never confirmed.
//
// Decision 10: an activity counts through its lead only while its `dealId` is
// null; once a convert moves it to the deal, only the deal decides. Work on a
// lead that is converted or archived is refused (409), so a done call left on
// a converted lead can never be reopened into work nothing shows.

type Meta = Partial<SalesRequestMeta>;

const ACTIVITY_NOT_FOUND = "Activity not found.";
const ACTIVITY_JUST_CHANGED = "This activity just changed. Refresh and try again.";
const REAL_DATE = "Enter a real date.";
const PICK_TIME = "Pick a time from the list.";
/** "HH:MM" on a 24-hour clock, 00:00 to 23:59. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

// --- Input ---

export const createActivitySchema = z.strictObject({
  type: z.enum(ACTIVITY_TYPES, { error: "Pick an activity type." }),
  /** Blank means the type's name ("Call"). */
  subject: z.string().trim().max(SUBJECT_MAX, { error: "Keep the subject under 200 characters." }).default(""),
  /** The day in app time, "YYYY-MM-DD". */
  dueDate: z.string({ error: REAL_DATE }).refine(isValidDateString, { error: REAL_DATE }),
  /** The time in app time, or null for "Any time" (due by the end of the day). */
  dueTime: z.string({ error: PICK_TIME }).regex(TIME_OF_DAY, { error: PICK_TIME }).nullable().default(null),
});

/** Plan 2 changes only whether an activity is done; nothing else about it can be edited yet. */
export const activityDoneSchema = z.strictObject({ done: z.boolean({ error: "Invalid input." }) });

export type CreateActivityInput = z.infer<typeof createActivitySchema>;

// --- Schedule ---

type CreateActivityResult = { ok: true; activity: PanelActivity } | SalesFail;

/**
 * Writes one activity, owned by the person who scheduled it (an admin
 * scheduling on someone else's deal or lead keeps it as their own to-do,
 * Decision 15), linked to its deal or lead and to that record's person. A time
 * is read in app time, so 9:30 AM on the DST Sunday is 13:30 UTC; with no time
 * it is due by the end of that day. Answers the activity and its history event.
 */
async function writeActivity(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  input: CreateActivityInput,
  link: { dealId: string } | { leadId: string },
  personId: string | null,
): Promise<{ activity: PanelActivity; event: ChildAuditEvent }> {
  const subject = input.subject || ACTIVITY_TYPE_LABELS[input.type];
  const dueAt = activityDueAt(input.dueDate, input.dueTime);
  const hasTime = input.dueTime !== null;
  const created = await tx.salesActivity.create({
    data: {
      type: input.type,
      subject,
      dueAt,
      hasTime,
      ownerId: actor.userId,
      createdBy: actor.userId,
      ...link,
      personId,
    },
    select: { id: true },
  });
  const activity: PanelActivity = {
    id: created.id,
    type: input.type,
    subject,
    dueAt: dueAt.toISOString(),
    hasTime,
    createdBy: actor.userId,
    ownerId: actor.userId,
  };
  return {
    activity,
    event: {
      action: "activity_added",
      after: {
        activityId: activity.id,
        type: activity.type,
        subject,
        dueAt: activity.dueAt,
        hasTime,
        createdBy: activity.createdBy,
      },
    },
  };
}

/** Adds an activity to a deal (see `writeActivity`). */
export async function createDealActivity(
  actor: SalesActor,
  dealId: string,
  input: CreateActivityInput,
  meta: Meta,
): Promise<CreateActivityResult> {
  return prisma.$transaction(async (tx): Promise<CreateActivityResult> => {
    const found = await findDealForEdit(tx, actor, dealId, { id: true, ownerId: true, personId: true });
    if (!found.ok) return found;
    const deal = found.deal;

    const { activity, event } = await writeActivity(tx, actor, input, { dealId: deal.id }, deal.personId);
    await recordDealAudit(tx, actor, deal.id, event, meta);
    return { ok: true, activity };
  });
}

/**
 * Adds an activity to an open lead (see `writeActivity`). The lead's row is
 * taken first (`takeOpenLead`), so this waits for, or loses to, a convert of
 * the same lead running at the same moment: the new activity is either moved
 * to the deal with the lead's other open work, or never made.
 */
export async function createLeadActivity(
  actor: SalesActor,
  leadId: string,
  input: CreateActivityInput,
  meta: Meta,
): Promise<CreateActivityResult> {
  return prisma.$transaction(async (tx): Promise<CreateActivityResult> => {
    const taken = await takeOpenLead(tx, actor, leadId);
    if (!taken.ok) return taken;
    const lead = taken.lead;

    const { activity, event } = await writeActivity(tx, actor, input, { leadId: lead.id }, lead.personId);
    await recordLeadAudit(tx, actor, lead.id, event, meta);
    return { ok: true, activity };
  });
}

// --- Done and reopened ---

/** The deal or lead an activity is reached through, and what the screen needs to ask for a next step. */
type ActivityParent = {
  kind: "deal" | "lead";
  id: string;
  title: string;
  status: string;
  openActivityCount: number;
};

type ActivityDoneResult =
  | {
      ok: true;
      /** False when the activity was already in that state: nothing was written. */
      changed: boolean;
      activity: { id: string; doneAt: string | null };
      /** `openActivityCount` tells the screen whether to ask for the next step. */
      parent: ActivityParent;
    }
  | SalesFail;

/** What an attempt answers when its guarded write matched nothing: another request changed the activity first. */
const RACED = Symbol("raced");

const PARENT_SELECT = { select: { id: true, title: true, status: true, ownerId: true } } as const;

/**
 * Ticks an activity done (`done: true`, at `now`) or opens it again. Ticking
 * one that is already done, or reopening an open one, changes nothing and
 * writes no history (Review Focus 4). The write lands only while the activity
 * is still as it was read, so a double-click's second request matches nothing,
 * reads again and answers as unchanged; a second miss answers 409.
 */
export async function setActivityDone(
  actor: SalesActor,
  activityId: string,
  done: boolean,
  meta: Meta,
  now: Date,
): Promise<ActivityDoneResult> {
  return prisma.$transaction(async (tx): Promise<ActivityDoneResult> => {
    for (let tries = 0; tries < 2; tries++) {
      const result = await attemptDone(tx, actor, activityId, done, meta, now);
      if (result !== RACED) return result;
    }
    return fail(409, ACTIVITY_JUST_CHANGED);
  });
}

/** One try: a fresh read through the deal's or lead's visibility, the edit and status checks, then the guarded write and its history row. */
async function attemptDone(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  activityId: string,
  done: boolean,
  meta: Meta,
  now: Date,
): Promise<ActivityDoneResult | typeof RACED> {
  const owner = dealOwnerWhere(actor, "everyone");
  const activity = await tx.salesActivity.findFirst({
    where: {
      id: activityId,
      archivedAt: null,
      OR: [
        { dealId: { not: null }, deal: { archivedAt: null, ...owner } },
        { dealId: null, leadId: { not: null }, lead: { archivedAt: null, ...owner } },
      ],
    },
    select: { id: true, type: true, subject: true, doneAt: true, dealId: true, deal: PARENT_SELECT, lead: PARENT_SELECT },
  });
  if (!activity) return fail(404, ACTIVITY_NOT_FOUND);
  // Through its deal once it has one; through its lead only while it has none.
  const onLead = activity.dealId === null;
  const parent = onLead ? activity.lead : activity.deal;
  if (!parent) return fail(404, ACTIVITY_NOT_FOUND);
  if (!canEditDeal(actor, parent)) return fail(403, onLead ? NOT_YOUR_LEAD : NOT_YOUR_DEAL);
  const closed = onLead && activity.lead ? refuseUnlessOpen(activity.lead.status) : null;
  if (closed) return closed;

  const changed = (activity.doneAt !== null) !== done;
  let doneAt = activity.doneAt;
  if (changed) {
    const { count } = await tx.salesActivity.updateMany({
      where: {
        id: activity.id,
        archivedAt: null,
        doneAt: done ? null : { not: null },
        // A convert that moved it to a deal a moment ago makes this miss, so the next try reaches it through the deal.
        ...(onLead ? { dealId: null } : {}),
      },
      data: { doneAt: done ? now : null },
    });
    if (count === 0) return RACED;
    doneAt = done ? now : null;
    const event: ChildAuditEvent = {
      action: done ? "activity_done" : "activity_reopened",
      after: { activityId: activity.id, type: activity.type, subject: activity.subject },
    };
    if (onLead) await recordLeadAudit(tx, actor, parent.id, event, meta);
    else await recordDealAudit(tx, actor, parent.id, event, meta);
  }

  const openActivityCount = await tx.salesActivity.count({
    where: onLead
      ? { leadId: parent.id, dealId: null, doneAt: null, archivedAt: null }
      : { dealId: parent.id, doneAt: null, archivedAt: null },
  });
  return {
    ok: true,
    changed,
    activity: { id: activity.id, doneAt: doneAt?.toISOString() ?? null },
    parent: { kind: onLead ? "lead" : "deal", id: parent.id, title: parent.title, status: parent.status, openActivityCount },
  };
}
