import Link from "next/link";
import { CalendarCheck, CalendarClock, ListTodo, Users } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { accessibleClientFilter, loadPermissions, taskVisibilityFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getTaskStatusOptions } from "@/lib/task-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBar } from "@/components/dashboard/status-bar";
import { StatusPill } from "@/components/tasks/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { StatCard } from "@/components/ui/stat-card";
import { TaskRow } from "@/components/tasks/task-row";

export default async function DashboardPage() {
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  // Scope the rollup to the viewer's accessible clients (+ internal tasks).
  const perms = await loadPermissions();
  const scoped = !!perms && !perms.isAdmin && !perms.allClientsAccess;
  const baseTaskScope: Prisma.TaskWhereInput = scoped
    ? { OR: [{ clientId: { in: [...perms!.clientIds] } }, { clientId: null }] }
    : {};
  const taskScope: Prisma.TaskWhereInput = { AND: [baseTaskScope, taskVisibilityFilter(perms?.userId ?? null)] };
  const clientScope = await accessibleClientFilter("id");

  const statusOptions = await getTaskStatusOptions();
  const completeStatusId = statusOptions.find((o) => o.isComplete)!.id;

  const [statusCounts, totalClients, activeClients, dueSoon] = await Promise.all([
    prisma.task.groupBy({ by: ["statusId"], where: taskScope, _count: { _all: true } }),
    prisma.client.count({ where: clientScope }),
    prisma.client.count({ where: { ...clientScope, status: "ACTIVE" } }),
    prisma.task.findMany({
      where: { ...taskScope, statusId: { not: completeStatusId }, deadline: { lte: sevenDaysFromNow } },
      include: {
        assignees: { include: { teamMember: { select: { id: true, name: true } } } },
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        workflowInstance: { select: { id: true, name: true } },
        statusOption: { select: { id: true, label: true, tone: true, isComplete: true } },
      },
      orderBy: { deadline: "asc" },
      take: 8,
    }),
  ]);

  const countByStatus = Object.fromEntries(statusCounts.map((row) => [row.statusId, row._count._all]));
  const openTasks = statusOptions
    .filter((o) => !o.isComplete)
    .reduce((sum, o) => sum + (countByStatus[o.id] ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Agency Dashboard
          <InfoTip>
            Your agency-wide overview. The numbers update live — click any tile or status pill to jump straight to those
            tasks.
          </InfoTip>
        </h1>
        <p className="mt-1 text-muted-foreground">A rollup across every client.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Open tasks"
          value={openTasks}
          href="/tasks"
          icon={ListTodo}
          tone="primary"
          delayMs={0}
        />
        <StatCard
          label="Active clients"
          value={
            <>
              {activeClients}
              <span className="whitespace-nowrap text-lg font-medium text-muted-foreground"> / {totalClients} total</span>
            </>
          }
          href="/clients"
          icon={Users}
          tone="primary"
          delayMs={60}
        />
        <StatCard
          label="Due in next 7 days"
          value={dueSoon.length}
          href="/tasks?deadline=SOON"
          icon={CalendarClock}
          tone="accent"
          delayMs={120}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tasks by status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusBar
            segments={statusOptions.map((option) => ({
              tone: option.tone as StatusTone,
              count: countByStatus[option.id] ?? 0,
            }))}
          />
          <div className="flex flex-wrap gap-3">
          {statusOptions.map((option, i) => (
            <Link
              key={option.id}
              href={`/tasks?status=${option.id}`}
              style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
              className="flex items-center gap-2 rounded-md p-1 animate-in fade-in slide-in-from-bottom-1 duration-300 transition-colors hover:bg-muted"
            >
              <StatusPill option={option} />
              <span className="text-sm text-muted-foreground">{countByStatus[option.id] ?? 0}</span>
            </Link>
          ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Due soon, across all clients</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {dueSoon.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="Nothing due in the next 7 days." />
          ) : (
            <div className="divide-y">
              {dueSoon.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showClient
                  statusOptions={statusOptions}
                  delayMs={Math.min(i * 40, 400)}
                />
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
