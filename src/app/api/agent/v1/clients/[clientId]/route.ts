import { NextResponse } from "next/server";

import { requireAgentToken } from "@/lib/agent-auth";
import { prisma } from "@/lib/prisma";
import { taskVisibilityFilter } from "@/lib/permissions";
import { getCompleteStatusId } from "@/lib/task-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/v1/clients/[clientId] — one client's full working picture:
 * info, open/overdue tasks, active projects (with current stage), direct
 * mail campaigns, assets waiting on a decision, and recent notes. This is
 * the endpoint an agent (Viktor) calls after /api/agent/v1/clients to answer
 * "what's going on with X."
 *
 * Deliberately excludes: the credentials vault (never queried here), private
 * tasks (taskVisibilityFilter(null) — same rule the app enforces for a
 * logged-out/no-viewer context), and HighLevel conversations/calls (out of
 * scope for this API entirely, per the 2026-08 decision to keep client SMS/
 * call content out of any external AI's reach for now).
 */
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const unauthorized = requireAgentToken(request);
  if (unauthorized) return unauthorized;

  const { clientId } = await params;
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
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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

  return NextResponse.json({
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
  });
}
