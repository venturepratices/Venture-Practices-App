import { loadPermissions, taskVisibilityFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getTaskStatusOptions } from "@/lib/task-status";
import { InfoTip } from "@/components/info-tip";
import { TaskList } from "@/components/tasks/task-list";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskViewToggle } from "@/components/tasks/task-view-toggle";

export default async function ClientTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { clientId } = await params;
  const { view } = await searchParams;
  const isBoard = view === "board";

  const perms = await loadPermissions();
  const [tasks, teamMembers, statusOptions] = await Promise.all([
    prisma.task.findMany({
      where: { AND: [{ clientId }, taskVisibilityFilter(perms?.userId ?? null)] },
      include: {
        assignees: { include: { teamMember: { select: { id: true, name: true } } } },
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        workflowInstance: { select: { id: true, name: true } },
        statusOption: { select: { id: true, label: true, tone: true, isComplete: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getTaskStatusOptions(),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Tasks
          <InfoTip>
            This client&apos;s tasks only. Anything you add here is automatically tied to this client — no need to pick
            one.
          </InfoTip>
        </h2>
        <TaskViewToggle view={isBoard ? "board" : "list"} />
      </div>
      <div className="mt-4">
        {/* Board only renders at md+; below that, List shows instead — see
            src/app/(app)/tasks/page.tsx for the full rationale. */}
        <div className={isBoard ? "hidden md:block" : undefined}>
          {isBoard ? (
            <TaskBoard tasks={tasks} statusOptions={statusOptions} />
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
    </div>
  );
}
