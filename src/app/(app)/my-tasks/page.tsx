import { CalendarCheck, Lock } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { taskVisibilityFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { TaskList } from "@/components/tasks/task-list";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskViewToggle } from "@/components/tasks/task-view-toggle";

type SearchParams = {
  view?: string;
  q?: string;
  status?: string;
  clientId?: string;
  assigneeId?: string;
  occurrence?: string;
  kind?: string;
  deadline?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
};

const TASK_INCLUDE = {
  assignees: { include: { teamMember: { select: { id: true, name: true } } } },
  client: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  workflowInstance: { select: { id: true, name: true } },
} as const;

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  const params = await searchParams;
  const isBoard = params.view === "board";
  const userId = session?.user?.id ?? null;

  // Filters (search bar + dropdowns) apply only to the main List/Board
  // section below — My Day and Private Tasks are fixed-purpose views and
  // shouldn't quietly narrow along with an unrelated status/kind filter.
  const filterClauses: Prisma.TaskWhereInput[] = [];
  if (params.q) {
    filterClauses.push({
      OR: [
        { title: { contains: params.q, mode: "insensitive" } },
        { description: { contains: params.q, mode: "insensitive" } },
      ],
    });
  }
  if (params.status) filterClauses.push({ status: params.status as Prisma.TaskWhereInput["status"] });
  if (params.clientId === "NONE") filterClauses.push({ clientId: null });
  else if (params.clientId) filterClauses.push({ clientId: params.clientId });
  if (params.assigneeId === "UNASSIGNED") filterClauses.push({ assignees: { none: {} } });
  else if (params.assigneeId) filterClauses.push({ assignees: { some: { teamMemberId: params.assigneeId } } });
  if (params.occurrence) filterClauses.push({ occurrence: params.occurrence as Prisma.TaskWhereInput["occurrence"] });
  if (params.kind) filterClauses.push({ kind: params.kind as Prisma.TaskWhereInput["kind"] });
  if (params.deadlineFrom || params.deadlineTo) {
    filterClauses.push({
      deadline: {
        ...(params.deadlineFrom ? { gte: new Date(params.deadlineFrom) } : {}),
        ...(params.deadlineTo ? { lte: endOfDay(params.deadlineTo) } : {}),
      },
    });
  } else if (params.deadline === "OVERDUE") {
    filterClauses.push({ deadline: { lt: new Date() } });
  } else if (params.deadline === "SOON") {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    filterClauses.push({ deadline: { gte: new Date(), lte: sevenDaysFromNow } });
  } else if (params.deadline === "NONE") {
    filterClauses.push({ deadline: null });
  }

  const [allAssignedTasks, filteredTasks, privateTasks, clients, teamMembers] = await Promise.all([
    // Unfiltered — used only to derive "My Day", which is always the true
    // today's-focus list regardless of whatever filters are set below.
    userId
      ? prisma.task.findMany({
          where: { AND: [{ assignees: { some: { teamMemberId: userId } } }, taskVisibilityFilter(userId)] },
          include: TASK_INCLUDE,
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    userId
      ? prisma.task.findMany({
          where: { AND: [{ assignees: { some: { teamMemberId: userId } } }, taskVisibilityFilter(userId), ...filterClauses] },
          include: TASK_INCLUDE,
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    // Fetched independently from the assignee-scoped list above — a private
    // task might not be assigned to anyone at all (a quick personal note),
    // so it wouldn't otherwise show up anywhere for its own creator.
    userId
      ? prisma.task.findMany({
          where: { createdById: userId, isPrivate: true },
          include: TASK_INCLUDE,
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const myDayTasks = allAssignedTasks
    .filter((task) => task.status !== "COMPLETE" && task.deadline && new Date(task.deadline) <= endOfToday)
    .sort((a, b) => (a.deadline && b.deadline ? +new Date(a.deadline) - +new Date(b.deadline) : 0));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            My Tasks
            <InfoTip>
              Only the tasks assigned to you, pulled from every client automatically. Tasks you add here are assigned to
              you by default.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Everything assigned to you, across every client.</p>
        </div>
        <TaskViewToggle view={isBoard ? "board" : "list"} />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            My Day
            <InfoTip>
              Your focus list for today: anything assigned to you that is overdue or due before midnight, sorted by
              deadline. Empty means you&apos;re caught up.
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {myDayTasks.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="Nothing overdue or due today. You're caught up." />
          ) : (
            <div className="divide-y">
              {myDayTasks.map((task) => (
                <TaskRow key={task.id} task={task} showClient />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {privateTasks.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="size-4" />
              Private tasks
              <InfoTip>
                Only you can see these — created by you and marked private. Toggle a task&apos;s Private setting off
                (from its detail panel) to make it visible to everyone again.
              </InfoTip>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {privateTasks.map((task) => (
                <TaskRow key={task.id} task={task} showClient />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6">
        <TaskFilters clients={clients} teamMembers={teamMembers} />
      </div>

      <div className="mt-4">
        {/* Board only renders at md+; below that, List shows instead — see
            src/app/(app)/tasks/page.tsx for the full rationale. */}
        <div className={isBoard ? "hidden md:block" : undefined}>
          {isBoard ? (
            filteredTasks.length === 0 ? (
              <div className="rounded-lg border">
                <EmptyState icon={CalendarCheck} title="No tasks match these filters." />
              </div>
            ) : (
              <TaskBoard tasks={filteredTasks} />
            )
          ) : (
            <TaskList
              tasks={filteredTasks}
              showClientColumn
              newTaskDefaults={{ assigneeId: session?.user?.id }}
              clients={clients}
              teamMembers={teamMembers}
            />
          )}
        </div>
        {isBoard ? (
          <div className="md:hidden">
            <TaskList
              tasks={filteredTasks}
              showClientColumn
              newTaskDefaults={{ assigneeId: session?.user?.id }}
              clients={clients}
              teamMembers={teamMembers}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
