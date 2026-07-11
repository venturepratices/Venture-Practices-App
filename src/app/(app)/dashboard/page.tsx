import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/tasks/status-pill";
import { TaskRow } from "@/components/tasks/task-row";
import { TASK_STATUS_VALUES } from "@/lib/validations/task";

export default async function DashboardPage() {
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const [statusCounts, totalClients, activeClients, dueSoon] = await Promise.all([
    prisma.task.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.client.count(),
    prisma.client.count({ where: { status: "ACTIVE" } }),
    prisma.task.findMany({
      where: { status: { not: "COMPLETE" }, deadline: { lte: sevenDaysFromNow } },
      include: { assignee: { select: { id: true, name: true } }, client: { select: { id: true, name: true } } },
      orderBy: { deadline: "asc" },
      take: 8,
    }),
  ]);

  const countByStatus = Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all]));
  const openTasks = TASK_STATUS_VALUES.filter((s) => s !== "COMPLETE").reduce(
    (sum, status) => sum + (countByStatus[status] ?? 0),
    0
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agency Dashboard</h1>
        <p className="mt-1 text-muted-foreground">A rollup across every client.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/tasks">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Open tasks</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{openTasks}</CardContent>
          </Card>
        </Link>
        <Link href="/clients">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Active clients</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">
              {activeClients} <span className="text-base font-normal text-muted-foreground">/ {totalClients} total</span>
            </CardContent>
          </Card>
        </Link>
        <Link href="/tasks?deadline=SOON">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Due in next 7 days</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{dueSoon.length}</CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tasks by status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {TASK_STATUS_VALUES.map((status) => (
            <Link
              key={status}
              href={`/tasks?status=${status}`}
              className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-muted"
            >
              <StatusPill status={status} />
              <span className="text-sm text-muted-foreground">{countByStatus[status] ?? 0}</span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Due soon, across all clients</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {dueSoon.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing due in the next 7 days.</p>
          ) : (
            <div className="divide-y">
              {dueSoon.map((task) => (
                <TaskRow key={task.id} task={task} showClient />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3 text-sm">
        <Link href="/tasks" className="text-primary underline-offset-4 hover:underline">
          View all tasks
        </Link>
        <Link href="/clients" className="text-primary underline-offset-4 hover:underline">
          View all clients
        </Link>
        <Link href="/my-tasks" className="text-primary underline-offset-4 hover:underline">
          View my tasks
        </Link>
      </div>
    </div>
  );
}
