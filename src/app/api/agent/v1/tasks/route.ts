import { NextResponse } from "next/server";

import { requireAgentToken } from "@/lib/agent-auth";
import { prisma } from "@/lib/prisma";
import { taskVisibilityFilter } from "@/lib/permissions";
import { getCompleteStatusId } from "@/lib/task-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/v1/tasks — cross-client task list, for questions
 * /api/agent/v1/clients/[clientId] can't answer because they're not scoped
 * to one client ("what are my tasks," "what's overdue across everything,"
 * "what is <name> working on"). Always excludes private tasks
 * (taskVisibilityFilter(null) — same rule the app applies for a
 * no-specific-viewer context) regardless of who's asking.
 *
 * Query params (all optional): clientId, assigneeName (case-insensitive
 * contains match), overdue=true, includeComplete=true.
 */
export async function GET(request: Request) {
  const unauthorized = requireAgentToken(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const assigneeName = url.searchParams.get("assigneeName") ?? undefined;
  const overdueOnly = url.searchParams.get("overdue") === "true";
  const includeComplete = url.searchParams.get("includeComplete") === "true";

  const completeStatusId = await getCompleteStatusId();
  const visibility = taskVisibilityFilter(null);

  const tasks = await prisma.task.findMany({
    where: {
      AND: [
        visibility,
        clientId ? { clientId } : {},
        includeComplete ? {} : { statusId: { not: completeStatusId } },
        overdueOnly ? { deadline: { lt: new Date() } } : {},
        assigneeName
          ? { assignees: { some: { teamMember: { name: { contains: assigneeName, mode: "insensitive" } } } } }
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

  return NextResponse.json({
    tasks: tasks.map((task) => ({
      title: task.title,
      client: task.client?.name ?? "Internal / no client",
      status: task.statusOption.label,
      deadline: task.deadline,
      overdue: task.deadline ? task.deadline < new Date() : false,
      assignees: task.assignees.map((a) => a.teamMember.name),
    })),
  });
}
