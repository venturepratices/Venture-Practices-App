import { prisma } from "@/lib/prisma";
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

  const tasks = await prisma.task.findMany({
    where: { clientId },
    include: { assignee: { select: { id: true, name: true } }, client: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <TaskViewToggle view={isBoard ? "board" : "list"} />
      </div>
      <div className="mt-4">
        {isBoard ? <TaskBoard tasks={tasks} /> : <TaskList tasks={tasks} newTaskDefaults={{ clientId }} />}
      </div>
    </div>
  );
}
