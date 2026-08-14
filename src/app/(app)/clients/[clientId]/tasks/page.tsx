import Link from "next/link";
import { ChevronLeft, ChevronRight, ListChecks } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { loadPermissions, taskVisibilityFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCompleteStatusId, getTaskStatusOptions } from "@/lib/task-status";
import { buildTaskFilterHref, buildTaskFilterWhere, type TaskFilterParams } from "@/lib/task-filter-where";
import { endOfDay, startOfDay, todayDateString } from "@/lib/utils";
import { InfoTip } from "@/components/info-tip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientTaskStats } from "@/components/clients/client-task-stats";
import { TaskList } from "@/components/tasks/task-list";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskViewToggle } from "@/components/tasks/task-view-toggle";
import { TaskFilters } from "@/components/tasks/task-filters";

// Matches the All Tasks page: Board must show every card in each column (a
// paginated column would misreport its count), so it gets a high ceiling
// instead of pagination. List paginates for real.
const LIST_PAGE_SIZE = 100;
const BOARD_TAKE_CEILING = 500;

type SearchParams = TaskFilterParams & { view?: string; page?: string };

export default async function ClientTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { clientId } = await params;
  const filterParams = await searchParams;
  const isBoard = filterParams.view === "board";

  const perms = await loadPermissions();
  const completeStatusId = await getCompleteStatusId();
  const { filters, searchClause } = buildTaskFilterWhere(filterParams, completeStatusId);

  // `clientId` is pinned from the route, never from the query string — the
  // filter bar deliberately hides its client dropdown here, and this also
  // means a hand-edited ?clientId= can't be used to peek at another client.
  const visibility = taskVisibilityFilter(perms?.userId ?? null);
  const finalWhere: Prisma.TaskWhereInput = {
    AND: [{ ...filters, clientId }, visibility, ...(searchClause ? [searchClause] : [])],
  };

  const page = Math.max(1, Number.parseInt(filterParams.page ?? "1", 10) || 1);
  const taskInclude = {
    assignees: { include: { teamMember: { select: { id: true, name: true } } } },
    client: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
    workflowInstance: { select: { id: true, name: true } },
    statusOption: { select: { id: true, label: true, tone: true, isComplete: true } },
  } as const;

  // The stat-card counts deliberately ignore the active filters — they're the
  // "what's true for this client right now" summary, so clicking Overdue must
  // not then recompute Overdue against the already-overdue-only list. They do
  // respect task visibility, so a private task never leaks into someone
  // else's count.
  const today = todayDateString();
  const openScope: Prisma.TaskWhereInput = {
    AND: [{ clientId }, visibility, ...(completeStatusId ? [{ statusId: { not: completeStatusId } }] : [])],
  };

  const [tasks, totalCount, teamMembers, statusOptions, overdueCount, dueTodayCount, openCount, needsDecisionCount] =
    await Promise.all([
      isBoard
        ? prisma.task.findMany({ where: finalWhere, include: taskInclude, orderBy: { createdAt: "desc" }, take: BOARD_TAKE_CEILING })
        : prisma.task.findMany({
            where: finalWhere,
            include: taskInclude,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * LIST_PAGE_SIZE,
            take: LIST_PAGE_SIZE,
          }),
      isBoard ? Promise.resolve(0) : prisma.task.count({ where: finalWhere }),
      prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      getTaskStatusOptions(),
      prisma.task.count({ where: { AND: [openScope, { deadline: { lt: startOfDay(today) } }] } }),
      prisma.task.count({ where: { AND: [openScope, { deadline: { gte: startOfDay(today), lte: endOfDay(today) } }] } }),
      prisma.task.count({ where: openScope }),
      prisma.asset.count({ where: { clientId, status: "IN_REVIEW" } }),
    ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / LIST_PAGE_SIZE));
  const rangeStartIndex = totalCount === 0 ? 0 : (page - 1) * LIST_PAGE_SIZE + 1;
  const rangeEndIndex = Math.min(page * LIST_PAGE_SIZE, totalCount);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Tasks
          <InfoTip>
            This client&apos;s tasks only. Anything you add here is automatically tied to this client — no need to pick
            one. The four numbers up top double as filters: click one to narrow the list, click it again to clear.
          </InfoTip>
        </h2>
        <TaskViewToggle view={isBoard ? "board" : "list"} />
      </div>

      <div className="mt-4">
        <ClientTaskStats
          clientId={clientId}
          counts={{
            overdue: overdueCount,
            dueToday: dueTodayCount,
            open: openCount,
            needsDecision: needsDecisionCount,
          }}
          params={filterParams}
        />
      </div>

      <div className="mt-4">
        <TaskFilters
          clients={[]}
          teamMembers={teamMembers}
          statusOptions={statusOptions}
          hideClientFilter
          searchPlaceholder="Search this client's tasks..."
        />
      </div>

      <div className="mt-4">
        {/* Board only renders at md+; below that, List shows instead — see
            src/app/(app)/tasks/page.tsx for the full rationale. */}
        <div className={isBoard ? "hidden md:block" : undefined}>
          {isBoard ? (
            tasks.length === 0 ? (
              <div className="rounded-lg border">
                <EmptyState icon={ListChecks} title="No tasks match these filters." />
              </div>
            ) : (
              <TaskBoard tasks={tasks} statusOptions={statusOptions} />
            )
          ) : (
            <TaskList tasks={tasks} newTaskDefaults={{ clientId }} lockClient teamMembers={teamMembers} statusOptions={statusOptions} />
          )}
        </div>
        {isBoard ? (
          <div className="md:hidden">
            <TaskList tasks={tasks} newTaskDefaults={{ clientId }} lockClient teamMembers={teamMembers} statusOptions={statusOptions} />
          </div>
        ) : null}
      </div>

      {!isBoard && totalCount > 0 ? (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Showing {rangeStartIndex}–{rangeEndIndex} of {totalCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              render={<Link href={buildTaskFilterHref(`/clients/${clientId}/tasks`, filterParams, { page: String(page - 1) })} scroll={false} />}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              render={<Link href={buildTaskFilterHref(`/clients/${clientId}/tasks`, filterParams, { page: String(page + 1) })} scroll={false} />}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
