import { prisma } from "@/lib/prisma";
import { hiddenPrivateTaskIds, taskVisibilityFilter } from "@/lib/permissions";
import { getCompleteStatusId } from "@/lib/task-status";

/**
 * Shared read-only queries behind BOTH doorways an external AI reaches this
 * app through: the REST endpoints at src/app/api/agent/v1/** (Viktor's
 * Custom Integration) and the MCP tools at src/app/api/mcp/[token]/route.ts
 * (Claude's custom connector). One source of truth so the two surfaces
 * never drift — same data, same exclusions, whichever door it comes through.
 *
 * Deliberately excludes, everywhere in this file: the credentials vault,
 * private tasks (taskVisibilityFilter(null) — the same rule the app applies
 * for a no-specific-viewer context), HighLevel conversations/calls, and
 * ClientOrder/billing data (kept opt-in inside the app itself via
 * canViewOrders/canManageOrders, so an external AI gets the same default).
 */

export async function listClients() {
  const completeStatusId = await getCompleteStatusId();
  const visibility = taskVisibilityFilter(null);

  const clients = await prisma.client.findMany({
    where: { status: { not: "OFFBOARDED" } },
    select: {
      id: true,
      name: true,
      status: true,
      contactName: true,
      source: true,
      _count: {
        select: {
          tasks: { where: { AND: [visibility, { statusId: { not: completeStatusId } }] } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const overdueCounts = await prisma.task.groupBy({
    by: ["clientId"],
    where: { AND: [visibility, { statusId: { not: completeStatusId } }, { deadline: { lt: new Date() } }] },
    _count: { _all: true },
  });
  const overdueByClient = new Map(overdueCounts.map((row) => [row.clientId, row._count._all]));

  return clients.map((client) => ({
    id: client.id,
    name: client.name,
    status: client.status,
    contactName: client.contactName,
    source: client.source,
    openTasks: client._count.tasks,
    overdueTasks: overdueByClient.get(client.id) ?? 0,
  }));
}

export async function getClientDetail(clientId: string) {
  const completeStatusId = await getCompleteStatusId();
  const visibility = taskVisibilityFilter(null);

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      status: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      website: true,
      source: true,
      about: true,
    },
  });
  if (!client) return null;

  const [openTasks, overdueTasks, workflows, campaigns, assetsNeedingDecision, recentNotes] = await Promise.all([
    prisma.task.findMany({
      where: { AND: [{ clientId }, visibility, { statusId: { not: completeStatusId } }] },
      select: {
        id: true,
        title: true,
        deadline: true,
        statusOption: { select: { label: true } },
        assignees: { select: { teamMember: { select: { name: true } } } },
      },
      orderBy: { deadline: "asc" },
      take: 50,
    }),
    prisma.task.count({
      where: { AND: [{ clientId }, visibility, { statusId: { not: completeStatusId } }, { deadline: { lt: new Date() } }] },
    }),
    prisma.workflowInstance.findMany({
      where: { clientId, status: "ACTIVE" },
      select: { id: true, name: true, currentStageNumber: true, stagesSnapshot: true },
    }),
    prisma.campaign.findMany({
      where: { clientId },
      select: { id: true, name: true, sequenceNumber: true, currentStage: true, mailDate: true },
      orderBy: { sequenceNumber: "desc" },
      take: 10,
    }),
    prisma.asset.findMany({
      where: { clientId, status: "IN_REVIEW" },
      select: { id: true, title: true },
    }),
    prisma.clientNote.findMany({
      where: { clientId },
      select: { body: true, createdAt: true, author: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return {
    client,
    tasks: {
      overdueCount: overdueTasks,
      open: openTasks.map((task) => ({
        title: task.title,
        status: task.statusOption.label,
        deadline: task.deadline,
        assignees: task.assignees.map((a) => a.teamMember.name),
      })),
    },
    projects: workflows.map((workflow) => {
      const stages = Array.isArray(workflow.stagesSnapshot) ? workflow.stagesSnapshot : [];
      const currentStage = stages[workflow.currentStageNumber - 1] as { name?: string } | undefined;
      return { name: workflow.name, currentStage: currentStage?.name ?? null };
    }),
    campaigns: campaigns.map((c) => ({
      name: c.name ?? `Campaign #${c.sequenceNumber}`,
      stage: c.currentStage,
      mailDate: c.mailDate,
    })),
    assetsNeedingDecision: assetsNeedingDecision.map((a) => a.title),
    recentNotes: recentNotes.map((note) => ({
      author: note.author?.name ?? "Unknown",
      body: note.body,
      createdAt: note.createdAt,
    })),
  };
}

export type ListTasksFilters = {
  clientId?: string;
  assigneeName?: string;
  overdueOnly?: boolean;
  includeComplete?: boolean;
};

export async function listTasks(filters: ListTasksFilters) {
  const completeStatusId = await getCompleteStatusId();
  const visibility = taskVisibilityFilter(null);

  const tasks = await prisma.task.findMany({
    where: {
      AND: [
        visibility,
        filters.clientId ? { clientId: filters.clientId } : {},
        filters.includeComplete ? {} : { statusId: { not: completeStatusId } },
        filters.overdueOnly ? { deadline: { lt: new Date() } } : {},
        filters.assigneeName
          ? { assignees: { some: { teamMember: { name: { contains: filters.assigneeName, mode: "insensitive" } } } } }
          : {},
      ],
    },
    select: {
      id: true,
      title: true,
      deadline: true,
      statusOption: { select: { label: true } },
      client: { select: { name: true } },
      assignees: { select: { teamMember: { select: { name: true } } } },
    },
    orderBy: { deadline: "asc" },
    take: 100,
  });

  return tasks.map((task) => ({
    title: task.title,
    client: task.client?.name ?? "Internal / no client",
    status: task.statusOption.label,
    deadline: task.deadline,
    overdue: task.deadline ? task.deadline < new Date() : false,
    assignees: task.assignees.map((a) => a.teamMember.name),
  }));
}

const EXCLUDED_ACTIVITY_ACTION_PREFIXES = ["credential_", "highlevel_"];
const EXCLUDED_ACTIVITY_ENTITY_TYPES = ["ClientOrder"];

export async function listActivity(opts: { clientId?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 20, 50);
  // No specific viewer here (this feeds an external AI, not a logged-in
  // person), so every private task is excluded, same as listTasks() above.
  const excludedTaskIds = await hiddenPrivateTaskIds(null);

  return prisma.activityLog.findMany({
    where: {
      ...(opts.clientId ? { clientId: opts.clientId } : {}),
      entityType: { notIn: EXCLUDED_ACTIVITY_ENTITY_TYPES },
      AND: EXCLUDED_ACTIVITY_ACTION_PREFIXES.map((prefix) => ({ NOT: { action: { startsWith: prefix } } })),
      ...(excludedTaskIds.length > 0 ? { NOT: { entityType: "Task", entityId: { in: excludedTaskIds } } } : {}),
    },
    select: {
      actorName: true,
      entityType: true,
      entityLabel: true,
      action: true,
      description: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function listTeam() {
  return prisma.teamMember.findMany({
    select: { name: true, email: true, isAdmin: true },
    orderBy: { name: "asc" },
  });
}
