import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import type { SalesDealStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { canEditDeal, dealOwnerWhere, type SalesActor } from "@/lib/sales/access";
import type { SalesRequestMeta } from "@/lib/sales/audit";
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES, SUBJECT_MAX } from "@/lib/sales/constants";
import { findDealForEdit, NOT_YOUR_DEAL } from "@/lib/sales/deal-access";
import { recordDealAudit } from "@/lib/sales/deal-audit";
import type { PanelActivity } from "@/lib/sales/deal-panel";
import { activityDueAt, isValidDateString } from "@/lib/sales/format";
import { fail, type SalesFail } from "@/lib/sales/http";

// Scheduling an activity on a deal, and ticking one done (or back to open).
// Each change runs in one transaction with its history row, written against
// the deal. Only the deal owner or an admin may do either (Decision 15); an
// activity is found only through a deal this person may see, so one on a
// hidden, deleted or reassigned deal is "not found", never confirmed.

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
 * Adds an activity to a deal, owned by the person who scheduled it (an admin
 * scheduling on someone else's deal keeps it as their own to-do, Decision 15)
 * and linked to the deal's person. A time is read in app time, so 9:30 AM on
 * the DST Sunday is 13:30 UTC; with no time it is due by the end of that day.
 */
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
        dealId: deal.id,
        personId: deal.personId,
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
    await recordDealAudit(
      tx,
      actor,
      deal.id,
      {
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
      meta,
    );
    return { ok: true, activity };
  });
}

// --- Done and reopened ---

type ActivityDoneResult =
  | {
      ok: true;
      /** False when the activity was already in that state: nothing was written. */
      changed: boolean;
      activity: { id: string; doneAt: string | null };
      /** `openActivityCount` tells the screen whether to ask for the next step. */
      deal: { id: string; title: string; status: SalesDealStatus; openActivityCount: number };
    }
  | SalesFail;

/** What an attempt answers when its guarded write matched nothing: another request changed the activity first. */
const RACED = Symbol("raced");

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

/** One try: a fresh read through the deal's visibility, the edit check, then the guarded write and its history row. */
async function attemptDone(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  activityId: string,
  done: boolean,
  meta: Meta,
  now: Date,
): Promise<ActivityDoneResult | typeof RACED> {
  const activity = await tx.salesActivity.findFirst({
    where: {
      id: activityId,
      archivedAt: null,
      dealId: { not: null },
      deal: { archivedAt: null, ...dealOwnerWhere(actor, "everyone") },
    },
    select: {
      id: true,
      type: true,
      subject: true,
      doneAt: true,
      deal: { select: { id: true, title: true, status: true, ownerId: true } },
    },
  });
  if (!activity?.deal) return fail(404, ACTIVITY_NOT_FOUND);
  const deal = activity.deal;
  if (!canEditDeal(actor, deal)) return fail(403, NOT_YOUR_DEAL);

  const changed = (activity.doneAt !== null) !== done;
  let doneAt = activity.doneAt;
  if (changed) {
    const { count } = await tx.salesActivity.updateMany({
      where: { id: activity.id, archivedAt: null, doneAt: done ? null : { not: null } },
      data: { doneAt: done ? now : null },
    });
    if (count === 0) return RACED;
    doneAt = done ? now : null;
    await recordDealAudit(
      tx,
      actor,
      deal.id,
      {
        action: done ? "activity_done" : "activity_reopened",
        after: { activityId: activity.id, type: activity.type, subject: activity.subject },
      },
      meta,
    );
  }

  const openActivityCount = await tx.salesActivity.count({ where: { dealId: deal.id, doneAt: null, archivedAt: null } });
  return {
    ok: true,
    changed,
    activity: { id: activity.id, doneAt: doneAt?.toISOString() ?? null },
    deal: { id: deal.id, title: deal.title, status: deal.status, openActivityCount },
  };
}
