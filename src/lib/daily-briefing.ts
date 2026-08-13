import { prisma } from "@/lib/prisma";
import { taskVisibilityFilter } from "@/lib/permissions";
import { getCompleteStatusId } from "@/lib/task-status";
import { endOfDay, startOfDay } from "@/lib/utils";
import type { TaskWithRelations } from "@/types/task";

// Same include shape as the Dashboard's "due soon" query — every briefing
// task list reuses <TaskRow> as-is, so it needs the identical relations.
const BRIEFING_TASK_INCLUDE = {
  assignees: { include: { teamMember: { select: { id: true, name: true } } } },
  client: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  workflowInstance: { select: { id: true, name: true } },
  statusOption: { select: { id: true, label: true, tone: true, isComplete: true } },
} as const;

export type NeedsDecisionAsset = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  dueDate: Date | null;
};

export type ClientBriefingData = {
  client: { id: string; name: string };
  dueToday: TaskWithRelations[];
  overdue: TaskWithRelations[];
  completedRecently: TaskWithRelations[];
  needsDecision: NeedsDecisionAsset[];
};

export type UserBriefingData = {
  dueToday: TaskWithRelations[];
  overdue: TaskWithRelations[];
  assignedRecently: TaskWithRelations[];
  needsDecision: NeedsDecisionAsset[];
};

export function isClientBriefingEmpty(data: ClientBriefingData): boolean {
  return (
    data.dueToday.length === 0 &&
    data.overdue.length === 0 &&
    data.completedRecently.length === 0 &&
    data.needsDecision.length === 0
  );
}

export function isUserBriefingEmpty(data: UserBriefingData): boolean {
  return (
    data.dueToday.length === 0 &&
    data.overdue.length === 0 &&
    data.assignedRecently.length === 0 &&
    data.needsDecision.length === 0
  );
}

/**
 * Everything happening on one client today: what's due, what's overdue,
 * what got finished since yesterday, and any asset still waiting on a
 * decision. Posted to that client's Slack channel every morning (see
 * src/app/api/cron/daily-briefing/route.ts) and rendered on the linked
 * report page — the two share this one query so they never disagree.
 * Returns null if the client doesn't exist (caller should 404).
 */
export async function getClientBriefingData(clientId: string, dateStr: string): Promise<ClientBriefingData | null> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
  if (!client) return null;

  const completeId = await getCompleteStatusId();
  const dayStart = startOfDay(dateStr);
  const dayEnd = endOfDay(dateStr);
  const sinceYesterday = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);

  const [dueToday, overdue, completedRecently, inReviewAssets] = await Promise.all([
    prisma.task.findMany({
      where: { clientId, statusId: { not: completeId }, deadline: { gte: dayStart, lte: dayEnd } },
      include: BRIEFING_TASK_INCLUDE,
      orderBy: { deadline: "asc" },
    }),
    prisma.task.findMany({
      where: { clientId, statusId: { not: completeId }, deadline: { lt: dayStart } },
      include: BRIEFING_TASK_INCLUDE,
      orderBy: { deadline: "asc" },
    }),
    prisma.task.findMany({
      where: { clientId, statusId: completeId, updatedAt: { gte: sinceYesterday, lte: dayEnd } },
      include: BRIEFING_TASK_INCLUDE,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.asset.findMany({
      where: { clientId, status: "IN_REVIEW" },
      select: { id: true, title: true, clientId: true, dueDate: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return {
    client,
    dueToday,
    overdue,
    completedRecently,
    needsDecision: inReviewAssets.map((a) => ({ id: a.id, title: a.title, clientId: a.clientId, clientName: client.name, dueDate: a.dueDate })),
  };
}

/**
 * One person's own slice across every client: what's due, what's overdue,
 * what landed on their plate in the last 24 hours, and any asset they
 * personally still need to decide on (an IN_REVIEW asset where they're a
 * reviewer with no AssetDecision yet on its latest version). DMed every
 * morning — the personal counterpart to getClientBriefingData above.
 */
export async function getUserBriefingData(teamMemberId: string, dateStr: string): Promise<UserBriefingData> {
  const completeId = await getCompleteStatusId();
  const dayStart = startOfDay(dateStr);
  const dayEnd = endOfDay(dateStr);
  const last24h = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
  const visibility = taskVisibilityFilter(teamMemberId);
  const assigneeFilter = { assignees: { some: { teamMemberId } } };

  const [dueToday, overdue, recentAssignments, reviewerRows] = await Promise.all([
    prisma.task.findMany({
      where: { AND: [assigneeFilter, visibility, { statusId: { not: completeId }, deadline: { gte: dayStart, lte: dayEnd } }] },
      include: BRIEFING_TASK_INCLUDE,
      orderBy: { deadline: "asc" },
    }),
    prisma.task.findMany({
      where: { AND: [assigneeFilter, visibility, { statusId: { not: completeId }, deadline: { lt: dayStart } }] },
      include: BRIEFING_TASK_INCLUDE,
      orderBy: { deadline: "asc" },
    }),
    prisma.taskAssignee.findMany({
      where: { teamMemberId, createdAt: { gte: last24h } },
      include: { task: { include: BRIEFING_TASK_INCLUDE } },
    }),
    prisma.assetReviewer.findMany({
      where: { teamMemberId },
      select: {
        id: true,
        asset: {
          select: {
            id: true,
            title: true,
            status: true,
            clientId: true,
            dueDate: true,
            client: { select: { name: true } },
            versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, decisions: { select: { reviewerId: true } } } },
          },
        },
      },
    }),
  ]);

  const assignedRecently = recentAssignments
    .map((r) => r.task)
    .filter((t) => t.statusId !== completeId && (!t.isPrivate || t.createdById === teamMemberId));

  const needsDecision = reviewerRows
    .filter((r) => {
      if (r.asset.status !== "IN_REVIEW") return false;
      const latest = r.asset.versions[0];
      if (!latest) return false;
      return !latest.decisions.some((d) => d.reviewerId === r.id);
    })
    .map((r) => ({ id: r.asset.id, title: r.asset.title, clientId: r.asset.clientId, clientName: r.asset.client.name, dueDate: r.asset.dueDate }));

  return { dueToday, overdue, assignedRecently, needsDecision };
}
