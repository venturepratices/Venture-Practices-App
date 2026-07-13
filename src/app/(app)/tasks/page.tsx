import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "@/lib/utils";
import { InfoTip } from "@/components/info-tip";
import { TaskList } from "@/components/tasks/task-list";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskViewToggle } from "@/components/tasks/task-view-toggle";
import { TaskFilters } from "@/components/tasks/task-filters";

type SearchParams = {
  view?: string;
  status?: string;
  clientId?: string;
  assigneeId?: string;
  occurrence?: string;
  deadline?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
};

export default async function AllTasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const isBoard = params.view === "board";

  const where: Prisma.TaskWhereInput = {};
  if (params.status) where.status = params.status as Prisma.TaskWhereInput["status"];
  if (params.clientId === "NONE") where.clientId = null;
  else if (params.clientId) where.clientId = params.clientId;
  if (params.assigneeId === "UNASSIGNED") where.assigneeId = null;
  else if (params.assigneeId) where.assigneeId = params.assigneeId;
  if (params.occurrence) where.occurrence = params.occurrence as Prisma.TaskWhereInput["occurrence"];

  if (params.deadlineFrom || params.deadlineTo) {
    where.deadline = {
      ...(params.deadlineFrom ? { gte: new Date(params.deadlineFrom) } : {}),
      ...(params.deadlineTo ? { lte: endOfDay(params.deadlineTo) } : {}),
    };
  } else if (params.deadline === "OVERDUE") {
    where.deadline = { lt: new Date() };
  } else if (params.deadline === "SOON") {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    where.deadline = { gte: new Date(), lte: sevenDaysFromNow };
  } else if (params.deadline === "NONE") {
    where.deadline = null;
  }

  const [tasks, clients, teamMembers] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { assignee: { select: { id: true, name: true } }, client: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

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
        <TaskFilters clients={clients} teamMembers={teamMembers} />
      </div>

      <div className="mt-4">
        {tasks.length === 0 ? (
          <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
            No tasks match these filters.
          </p>
        ) : isBoard ? (
          <TaskBoard tasks={tasks} showClientOnCards />
        ) : (
          <TaskList tasks={tasks} showClientColumn newTaskDefaults={{}} clients={clients} teamMembers={teamMembers} />
        )}
      </div>
    </div>
  );
}
