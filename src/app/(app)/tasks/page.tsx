import Link from "next/link";
import { ChevronLeft, ChevronRight, ListChecks } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { accessibleClientFilter, loadPermissions, taskVisibilityFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCompleteStatusId, getTaskStatusOptions } from "@/lib/task-status";
import { buildTaskFilterHref, buildTaskFilterWhere, type TaskFilterParams } from "@/lib/task-filter-where";
import { InfoTip } from "@/components/info-tip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TaskList } from "@/components/tasks/task-list";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskViewToggle } from "@/components/tasks/task-view-toggle";
import { TaskFilters } from "@/components/tasks/task-filters";

// Board view must show every matching task in each column (a paginated column
// would silently hide cards and misreport counts), so it gets a high safety
// ceiling instead of real pagination — the same "cap, don't paginate" choice
// already used for the Archive page's tabs. List view gets real pagination.
const LIST_PAGE_SIZE = 100;
const BOARD_TAKE_CEILING = 500;

type SearchParams = TaskFilterParams & { view?: string; page?: string };

export default async function AllTasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const isBoard = params.view === "board";

  // Shared with each client's own Tasks tab (src/lib/task-filter-where.ts) so
  // the two pages' filters can never drift apart.
  const completeStatusId = await getCompleteStatusId();
  const { filters: where, searchClause } = buildTaskFilterWhere(params, completeStatusId);

  // Scope to the viewer's accessible clients (+ internal client-less tasks).
  // ANDed with any client filter above, so a scoped member can never widen
  // their view by passing a clientId they don't have access to.
  const perms = await loadPermissions();
  if (perms && !perms.isAdmin && !perms.allClientsAccess) {
    where.OR = [{ clientId: { in: [...perms.clientIds] } }, { clientId: null }];
  }
  const clientWhere = await accessibleClientFilter("id");
  const finalWhere: Prisma.TaskWhereInput = {
    AND: [where, taskVisibilityFilter(perms?.userId ?? null), ...(searchClause ? [searchClause] : [])],
  };

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const taskInclude = {
    assignees: { include: { teamMember: { select: { id: true, name: true } } } },
    client: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
    workflowInstance: { select: { id: true, name: true } },
    statusOption: { select: { id: true, label: true, tone: true, isComplete: true } },
  } as const;

  const [tasks, totalCount, clients, teamMembers, statusOptions] = await Promise.all([
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
    prisma.client.findMany({ where: clientWhere, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getTaskStatusOptions(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / LIST_PAGE_SIZE));
  const rangeStartIndex = totalCount === 0 ? 0 : (page - 1) * LIST_PAGE_SIZE + 1;
  const rangeEndIndex = Math.min(page * LIST_PAGE_SIZE, totalCount);

  function pageHref(targetPage: number): string {
    return buildTaskFilterHref("/tasks", params, { page: String(targetPage) });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            All Tasks
            <InfoTip>
              Every task from every client in one list. Narrow it down with the filters below, switch between List and
              Board view (top right), change a status right from its pill, or click a row for full details.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Every task across every client, filterable.</p>
        </div>
        <TaskViewToggle view={isBoard ? "board" : "list"} />
      </div>

      <div className="mt-4">
        <TaskFilters clients={clients} teamMembers={teamMembers} statusOptions={statusOptions} />
      </div>

      <div className="mt-4">
        {/* Board is unwieldy on a phone-width viewport, so it only renders at md+;
            below that, List always shows instead — Board stays manually selectable
            via the toggle above, it just renders as List until the screen is wide
            enough for horizontally-scrolling columns. */}
        <div className={isBoard ? "hidden md:block" : undefined}>
          {isBoard ? (
            tasks.length === 0 ? (
              <div className="rounded-lg border">
                <EmptyState icon={ListChecks} title="No tasks match these filters." />
              </div>
            ) : (
              <TaskBoard tasks={tasks} showClientOnCards statusOptions={statusOptions} />
            )
          ) : (
            // TaskList always renders (even with zero tasks) so its own "Add task" box
            // stays visible — it already handles its own empty state internally.
            <TaskList tasks={tasks} showClientColumn newTaskDefaults={{}} clients={clients} teamMembers={teamMembers} statusOptions={statusOptions} />
          )}
        </div>
        {isBoard ? (
          <div className="md:hidden">
            <TaskList tasks={tasks} showClientColumn newTaskDefaults={{}} clients={clients} teamMembers={teamMembers} statusOptions={statusOptions} />
          </div>
        ) : null}
      </div>

      {!isBoard && totalCount > 0 ? (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Showing {rangeStartIndex}–{rangeEndIndex} of {totalCount}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} render={<Link href={pageHref(page - 1)} scroll={false} />}>
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
              render={<Link href={pageHref(page + 1)} scroll={false} />}
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
