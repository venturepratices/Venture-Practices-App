import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { TaskList } from "@/components/tasks/task-list";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskViewToggle } from "@/components/tasks/task-view-toggle";

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await auth();
  const { view } = await searchParams;
  const isBoard = view === "board";

  const [tasks, clients, teamMembers] = await Promise.all([
    session?.user?.id
      ? prisma.task.findMany({
          where: { assigneeId: session.user.id },
          include: { assignee: { select: { id: true, name: true } }, client: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const myDayTasks = tasks
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
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing overdue or due today. You&apos;re caught up.
            </p>
          ) : (
            <div className="divide-y">
              {myDayTasks.map((task) => (
                <TaskRow key={task.id} task={task} showClient />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6">
        {isBoard ? (
          <TaskBoard tasks={tasks} />
        ) : (
          <TaskList
            tasks={tasks}
            showClientColumn
            newTaskDefaults={{ assigneeId: session?.user?.id }}
            clients={clients}
            teamMembers={teamMembers}
          />
        )}
      </div>
    </div>
  );
}
