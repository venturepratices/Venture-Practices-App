import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { SalesActor } from "@/lib/sales/access";
import type { SalesRequestMeta } from "@/lib/sales/audit";
import { LOST_COMMENT_MAX, LOST_REASONS, MAX_DEAL_CENTS } from "@/lib/sales/constants";
import { findDealForEdit } from "@/lib/sales/deal-access";
import { recordDealAudit } from "@/lib/sales/deal-audit";
import { fail, type SalesFail } from "@/lib/sales/http";
import { activitiesOnStageEntry, checkStageMove } from "@/lib/sales/rules";

// Moving a deal between stages, and marking it won, lost or open again. Each
// change runs in one transaction with its history rows, and every check that
// can refuse runs before the first write: a refusal is returned from the
// transaction (which then commits), so nothing may have been written by then.
// The stage rules (the proposal money rule, the No Show reschedule call) are
// checked here on the server, against what is stored, never what a screen shows.

type Meta = Partial<SalesRequestMeta>;

const DEAL_CLOSED = "This deal is closed. Reopen it first.";
const STAGE_NOT_IN_PIPELINE = "That stage is not part of this deal's pipeline.";
const VALUE_TOO_BIG = "Values can be up to $10,000,000.";
/** The rule whose call an undo may take back (Decision 24). Matches the `createdBy` in rules.ts. */
const NO_SHOW_RULE = "rule:no-show";
const RULE = { system: "rule" } as const;
const ID_MAX = 64;
/** Undo only ever sends the ids the move just answered with; one stage adds at most a few. */
const UNDO_IDS_MAX = 10;

// --- Input ---

const money = z
  .int({ error: "Enter an amount." })
  .min(0, { error: "Values can't be below $0." })
  .max(MAX_DEAL_CENTS, { error: VALUE_TOO_BIG });

const id = z.string().min(1).max(ID_MAX);

export const moveDealSchema = z.strictObject({
  stageId: id,
  /** Sent by the "Save and move" value dialog; otherwise the stored values are used. */
  valueCents: money.optional(),
  mrrCents: money.optional(),
  /** Undoing a move: the rule-made activities that move added, to take back with it. */
  undoActivityIds: z.array(id).max(UNDO_IDS_MAX).optional(),
});

const PICK_REASON = "Pick a reason.";

export const statusSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("WON") }),
  z.strictObject({
    status: z.literal("LOST"),
    lostReason: z.enum(LOST_REASONS, { error: PICK_REASON }),
    lostComment: z
      .string()
      .trim()
      .max(LOST_COMMENT_MAX, { error: "Keep the comment under 1,000 characters." })
      .optional(),
  }),
  z.strictObject({ status: z.literal("OPEN") }),
]);

export type MoveDealInput = z.infer<typeof moveDealSchema>;
export type DealStatusInput = z.infer<typeof statusSchema>;

// --- Stage moves ---

export type MoveResult = {
  ok: true;
  /** False when the deal was already in that stage: nothing was written. */
  changed: boolean;
  deal: { id: string; stageId: string; stageEnteredAt: string; valueCents: number; mrrCents: number };
  previousStageId: string;
  enteredStage: { id: string; name: string; isWon: boolean; isLost: boolean; isNoShow: boolean };
  /** Activities a stage rule added (the No Show reschedule call), so Undo can take them back. */
  createdActivityIds: string[];
};

const MOVE_DEAL_SELECT = {
  id: true,
  ownerId: true,
  personId: true,
  status: true,
  pipelineId: true,
  stageId: true,
  stageEnteredAt: true,
  valueCents: true,
  mrrCents: true,
  stage: { select: { name: true } },
} satisfies Prisma.SalesDealSelect;

const TARGET_STAGE_SELECT = {
  id: true,
  name: true,
  isWon: true,
  isLost: true,
  isNoShow: true,
  requiresValue: true,
} satisfies Prisma.SalesStageSelect;

/**
 * Moves an open deal to another stage of its pipeline, saving any values sent
 * with the move. Proposal Sent needs both values, checked against what is
 * stored when the screen sends none (Review Focus 1). Entering No Show adds the
 * reschedule call unless one is still open; the stage the deal is already in
 * changes nothing (Review Focus 4). An undo names the rule-made calls to take
 * back: only this deal's open No Show calls are removed (Decision 24).
 */
export async function moveDealStage(
  actor: SalesActor,
  dealId: string,
  input: MoveDealInput,
  meta: Meta,
  now: Date,
): Promise<MoveResult | SalesFail> {
  return prisma.$transaction(async (tx): Promise<MoveResult | SalesFail> => {
    const found = await findDealForEdit(tx, actor, dealId, MOVE_DEAL_SELECT);
    if (!found.ok) return found;
    const deal = found.deal;
    if (deal.status !== "OPEN") return fail(409, DEAL_CLOSED);

    const target = await tx.salesStage.findFirst({
      where: { id: input.stageId, pipelineId: deal.pipelineId, archivedAt: null },
      select: TARGET_STAGE_SELECT,
    });
    if (!target) return fail(400, STAGE_NOT_IN_PIPELINE);
    const enteredStage = {
      id: target.id,
      name: target.name,
      isWon: target.isWon,
      isLost: target.isLost,
      isNoShow: target.isNoShow,
    };

    if (target.id === deal.stageId) {
      return {
        ok: true,
        changed: false,
        deal: {
          id: deal.id,
          stageId: deal.stageId,
          stageEnteredAt: deal.stageEnteredAt.toISOString(),
          valueCents: deal.valueCents,
          mrrCents: deal.mrrCents,
        },
        previousStageId: deal.stageId,
        enteredStage,
        createdActivityIds: [],
      };
    }

    const value = { valueCents: input.valueCents ?? deal.valueCents, mrrCents: input.mrrCents ?? deal.mrrCents };
    const violation = checkStageMove(value, target);
    if (violation) return fail(422, violation.message, violation.code);

    // Checks done; from here on everything is written.
    const data: Prisma.SalesDealUncheckedUpdateInput = { stageId: target.id, stageEnteredAt: now };
    if (value.valueCents !== deal.valueCents) data.valueCents = value.valueCents;
    if (value.mrrCents !== deal.mrrCents) data.mrrCents = value.mrrCents;
    await tx.salesDeal.update({ where: { id: deal.id }, data, select: { id: true } });

    if (value.valueCents !== deal.valueCents || value.mrrCents !== deal.mrrCents) {
      await recordDealAudit(
        tx,
        actor,
        deal.id,
        { action: "value_changed", before: { valueCents: deal.valueCents, mrrCents: deal.mrrCents }, after: value },
        meta,
      );
    }
    await recordDealAudit(
      tx,
      actor,
      deal.id,
      {
        action: "stage_changed",
        before: { stageId: deal.stageId, stageName: deal.stage.name },
        after: { stageId: target.id, stageName: target.name },
      },
      meta,
    );

    const createdActivityIds = await addStageEntryActivities(tx, deal, target, now);
    if (input.undoActivityIds && input.undoActivityIds.length > 0) {
      await removeUndoneRuleActivities(tx, actor, deal.id, input.undoActivityIds, meta, now);
    }

    return {
      ok: true,
      changed: true,
      deal: { id: deal.id, stageId: target.id, stageEnteredAt: now.toISOString(), ...value },
      previousStageId: deal.stageId,
      enteredStage,
      createdActivityIds,
    };
  });
}

/**
 * Adds the follow-ups a stage rule asks for when a deal enters a stage, owned by
 * the deal owner (Decision 15) and recorded as the rule's doing. A rule activity
 * is skipped while an open one from the same rule is already on the deal, so
 * moving into No Show twice never makes a second reschedule call. Shared by the
 * stage move and the daily missed-meeting job. Answers with the new ids.
 */
export async function addStageEntryActivities(
  tx: Prisma.TransactionClient,
  deal: { id: string; ownerId: string; personId: string | null },
  target: { isNoShow: boolean },
  now: Date,
): Promise<string[]> {
  const planned = activitiesOnStageEntry(target, now);
  if (planned.length === 0) return [];

  const open = await tx.salesActivity.findMany({
    where: {
      dealId: deal.id,
      createdBy: { in: planned.map((activity) => activity.createdBy) },
      doneAt: null,
      archivedAt: null,
    },
    select: { createdBy: true },
  });
  const alreadyOpen = new Set(open.map((activity) => activity.createdBy));

  const createdIds: string[] = [];
  for (const activity of planned) {
    if (alreadyOpen.has(activity.createdBy)) continue;
    const created = await tx.salesActivity.create({
      data: { ...activity, ownerId: deal.ownerId, dealId: deal.id, personId: deal.personId },
      select: { id: true },
    });
    await recordDealAudit(tx, RULE, deal.id, {
      action: "activity_added",
      after: {
        activityId: created.id,
        type: activity.type,
        subject: activity.subject,
        dueAt: activity.dueAt.toISOString(),
        hasTime: activity.hasTime,
        createdBy: activity.createdBy,
      },
    });
    createdIds.push(created.id);
  }
  return createdIds;
}

/** Undo of a move: removes the named activities that are this deal's still-open No Show calls, and nothing else. */
async function removeUndoneRuleActivities(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  dealId: string,
  activityIds: string[],
  meta: Meta,
  now: Date,
): Promise<void> {
  const undone = await tx.salesActivity.findMany({
    where: { id: { in: activityIds }, dealId, createdBy: NO_SHOW_RULE, doneAt: null, archivedAt: null },
    select: { id: true, type: true, subject: true },
  });
  if (undone.length === 0) return;

  await tx.salesActivity.updateMany({ where: { id: { in: undone.map((activity) => activity.id) } }, data: { archivedAt: now } });
  for (const activity of undone) {
    await recordDealAudit(
      tx,
      actor,
      dealId,
      { action: "activity_removed", before: { activityId: activity.id, type: activity.type, subject: activity.subject } },
      meta,
    );
  }
}

// --- Won, lost, reopen ---

type StatusDeal = { id: string; status: "OPEN" | "WON" | "LOST"; wonAt: string | null; lostAt: string | null; lostReason: string | null };
type SetStatusResult = { ok: true; changed: boolean; deal: StatusDeal } | SalesFail;

const STATUS_DEAL_SELECT = {
  id: true,
  ownerId: true,
  status: true,
  wonAt: true,
  lostAt: true,
  lostReason: true,
} satisfies Prisma.SalesDealSelect;

/**
 * Marks a deal won or lost, or reopens it (Decision 3: status changes only
 * through these, never by entering a stage). Lost always carries a reason,
 * and may carry a comment. Each status clears the dates and reason of the
 * others, so a reopened deal is plainly open. The status it already has
 * changes nothing (Review Focus 4). The deal stays in its stage throughout.
 */
export async function setDealStatus(
  actor: SalesActor,
  dealId: string,
  input: DealStatusInput,
  meta: Meta,
  now: Date,
): Promise<SetStatusResult> {
  return prisma.$transaction(async (tx): Promise<SetStatusResult> => {
    const found = await findDealForEdit(tx, actor, dealId, STATUS_DEAL_SELECT);
    if (!found.ok) return found;
    const deal = found.deal;

    if (deal.status === input.status) {
      return {
        ok: true,
        changed: false,
        deal: {
          id: deal.id,
          status: deal.status,
          wonAt: deal.wonAt?.toISOString() ?? null,
          lostAt: deal.lostAt?.toISOString() ?? null,
          lostReason: deal.lostReason,
        },
      };
    }

    let data: Prisma.SalesDealUncheckedUpdateInput;
    let after: { status: "OPEN" | "WON" | "LOST"; lostReason?: string; lostComment?: string };
    if (input.status === "LOST") {
      // A blank comment is no comment.
      const lostComment = input.lostComment || null;
      data = { status: "LOST", lostAt: now, lostReason: input.lostReason, lostComment, wonAt: null };
      after = lostComment
        ? { status: "LOST", lostReason: input.lostReason, lostComment }
        : { status: "LOST", lostReason: input.lostReason };
    } else if (input.status === "WON") {
      data = { status: "WON", wonAt: now, lostAt: null, lostReason: null, lostComment: null };
      after = { status: "WON" };
    } else {
      data = { status: "OPEN", wonAt: null, lostAt: null, lostReason: null, lostComment: null };
      after = { status: "OPEN" };
    }

    await tx.salesDeal.update({ where: { id: deal.id }, data, select: { id: true } });
    await recordDealAudit(tx, actor, deal.id, { action: "status_changed", before: { status: deal.status }, after }, meta);

    return {
      ok: true,
      changed: true,
      deal: {
        id: deal.id,
        status: input.status,
        wonAt: input.status === "WON" ? now.toISOString() : null,
        lostAt: input.status === "LOST" ? now.toISOString() : null,
        lostReason: input.status === "LOST" ? input.lostReason : null,
      },
    };
  });
}
