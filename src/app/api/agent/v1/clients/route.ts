import { NextResponse } from "next/server";

import { requireAgentToken } from "@/lib/agent-auth";
import { prisma } from "@/lib/prisma";
import { taskVisibilityFilter } from "@/lib/permissions";
import { getCompleteStatusId } from "@/lib/task-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/v1/clients — every client with a quick status snapshot.
 * The overview list an agent (Viktor) reads before drilling into one client
 * via /api/agent/v1/clients/[clientId]. Read-only, no write counterpart
 * exists anywhere under /api/agent.
 */
export async function GET(request: Request) {
  const unauthorized = requireAgentToken(request);
  if (unauthorized) return unauthorized;

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

  return NextResponse.json({
    clients: clients.map((client) => ({
      id: client.id,
      name: client.name,
      status: client.status,
      contactName: client.contactName,
      source: client.source,
      openTasks: client._count.tasks,
      overdueTasks: overdueByClient.get(client.id) ?? 0,
    })),
  });
}
