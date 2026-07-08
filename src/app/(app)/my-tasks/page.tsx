import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TaskList } from "@/components/tasks/task-list";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskViewToggle } from "@/components/tasks/task-view-toggle";

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await auth();
  const { view } = await searchParams;
  const isBoard = view === "board";

  const tasks = session?.user?.id
    ? await prisma.task.findMany({
        where: { assigneeId: session.user.id },
        include: { assignee: { select: { id: true, name: true } }, client: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My Tasks</h1>
          <p className="mt-1 text-muted-foreground">Everything assigned to you, across every client.</p>
        </div>
        <TaskViewToggle view={isBoard ? "board" : "list"} />
      </div>
      <div className="mt-4">
        {isBoard ? (
          <TaskBoard tasks={tasks} />
        ) : (
          <TaskList tasks={tasks} showClientColumn newTaskDefaults={{ assigneeId: session?.user?.id }} />
        )}
      </div>
    </div>
  );
}
