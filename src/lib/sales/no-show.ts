import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { MISSED_MEETING_BATCH } from "@/lib/sales/constants";
import { recordDealAudit } from "@/lib/sales/deal-audit";
import { addStageEntryActivities } from "@/lib/sales/stage-moves";
import { dateInputValue, startOfDay } from "@/lib/utils";

// The missed-meeting rule (spec rule 5, Decision 1), run once a day by the
// sales-no-show cron. A meeting on an open deal that was not marked done by the
// end of its day moves the deal to its pipeline's No Show stage, is marked
// missed, and gets the reschedule call. Deals already at or past No Show are
// never moved back. The rule acts as `{ system: "rule" }`: no person, no
// request, and nothing is sent to Slack, email or anywhere else.

type NoShowDb = Pick<typeof prisma, "salesStage" | "salesActivity" | "$transaction">;
type NoShowStage = { id: string; pipelineId: string; name: string; position: number };
type MissedMeeting = { id: string; subject: string };

const RULE = { system: "rule" } as const;

/**
 * Finds up to MISSED_MEETING_BATCH missed meetings (oldest first, in one indexed
 * query) and handles each deal in its own transaction, re-reading it as open,
 * so one bad deal does not roll back the others. Answers with how many deals
 * moved and how many meetings were marked missed.
 */
export async function applyMissedMeetingRule(
  now: Date,
  db: NoShowDb = prisma,
): Promise<{ moved: number; meetingsMarked: number }> {
  const stages = await db.salesStage.findMany({
    where: { isNoShow: true, archivedAt: null, pipeline: { archivedAt: null } },
    orderBy: { position: "asc" },
    select: { id: true, pipelineId: true, name: true, position: true },
  });
  // Each pipeline's first No Show stage (the seeded pipelines have one each).
  const noShowByPipeline = new Map<string, NoShowStage>();
  for (const stage of stages) {
    if (!noShowByPipeline.has(stage.pipelineId)) noShowByPipeline.set(stage.pipelineId, stage);
  }
  if (noShowByPipeline.size === 0) return { moved: 0, meetingsMarked: 0 };

  // A meeting is missed once its whole day has ended in app time, so this morning's run looks before today.
  const meetings = await db.salesActivity.findMany({
    where: {
      type: "MEETING",
      doneAt: null,
      archivedAt: null,
      dueAt: { lt: startOfDay(dateInputValue(now)) },
      deal: { status: "OPEN", archivedAt: null },
      OR: [...noShowByPipeline.values()].map((stage) => ({
        deal: { pipelineId: stage.pipelineId, stage: { position: { lt: stage.position } } },
      })),
    },
    orderBy: { dueAt: "asc" },
    take: MISSED_MEETING_BATCH,
    select: { id: true, subject: true, dealId: true },
  });

  const meetingsByDeal = new Map<string, MissedMeeting[]>();
  for (const { dealId, ...meeting } of meetings) {
    if (!dealId) continue;
    meetingsByDeal.set(dealId, [...(meetingsByDeal.get(dealId) ?? []), meeting]);
  }

  let moved = 0;
  let meetingsMarked = 0;
  for (const [dealId, dealMeetings] of meetingsByDeal) {
    try {
      const marked = await db.$transaction((tx) => moveDealToNoShow(tx, dealId, dealMeetings, noShowByPipeline, now));
      if (marked > 0) {
        moved += 1;
        meetingsMarked += marked;
      }
    } catch (error) {
      // Logged and skipped; the meeting is still open, so tomorrow's run tries this deal again.
      console.error(`Sales No Show rule failed for deal ${dealId}:`, error);
    }
  }
  return { moved, meetingsMarked };
}

/**
 * One deal's share of the rule, inside its own transaction. Re-reads the deal
 * (still open, still before No Show) and its meetings (still not done), since
 * either may have changed since the meeting query. Answers with the number of
 * meetings marked missed, 0 when the deal was left alone.
 */
async function moveDealToNoShow(
  tx: Prisma.TransactionClient,
  dealId: string,
  meetings: MissedMeeting[],
  noShowByPipeline: Map<string, NoShowStage>,
  now: Date,
): Promise<number> {
  const deal = await tx.salesDeal.findFirst({
    where: { id: dealId, status: "OPEN", archivedAt: null },
    select: {
      id: true,
      ownerId: true,
      personId: true,
      pipelineId: true,
      stageId: true,
      stage: { select: { name: true, position: true } },
    },
  });
  if (!deal) return 0;
  const noShow = noShowByPipeline.get(deal.pipelineId);
  if (!noShow || deal.stage.position >= noShow.position) return 0;

  const stillOpen = await tx.salesActivity.findMany({
    where: { id: { in: meetings.map((meeting) => meeting.id) }, type: "MEETING", doneAt: null, archivedAt: null },
    select: { id: true },
  });
  const openIds = new Set(stillOpen.map((meeting) => meeting.id));
  const missed = meetings.filter((meeting) => openIds.has(meeting.id));
  if (missed.length === 0) return 0;

  await tx.salesDeal.update({
    where: { id: deal.id },
    data: { stageId: noShow.id, stageEnteredAt: now },
    select: { id: true },
  });
  await recordDealAudit(tx, RULE, deal.id, {
    action: "stage_changed",
    before: { stageId: deal.stageId, stageName: deal.stage.name },
    after: { stageId: noShow.id, stageName: noShow.name },
  });

  await tx.salesActivity.updateMany({ where: { id: { in: missed.map((meeting) => meeting.id) } }, data: { archivedAt: now } });
  for (const meeting of missed) {
    await recordDealAudit(tx, RULE, deal.id, {
      action: "activity_missed",
      after: { activityId: meeting.id, type: "MEETING", subject: meeting.subject },
    });
  }

  await addStageEntryActivities(tx, deal, { isNoShow: true }, now);
  return missed.length;
}
