import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ListChecks } from "lucide-react";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTaskStatusOptions } from "@/lib/task-status";
import { getPriorityLevelOptions } from "@/lib/priority-level";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PrivatePriorityFilter } from "@/components/tasks/private-priority-filter";
import { PrivateProjectHeader } from "@/components/tasks/private-project-header";
import { PrivateTaskQuickAdd } from "@/components/tasks/private-task-quick-add";
import { TaskRow } from "@/components/tasks/task-row";

const TASK_INCLUDE = {
  assignees: { include: { teamMember: { select: { id: true, name: true } } } },
  client: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  workflowInstance: { select: { id: true, name: true } },
  statusOption: { select: { id: true, label: true, tone: true, color: true, isComplete: true } },
  priorityLevel: { select: { id: true, label: true, color: true } },
} as const;

export default async function PrivateProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ priorityLevelId?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const { projectId } = await params;
  const { priorityLevelId: priorityFilter } = await searchParams;

  const project = await prisma.privateProject.findUnique({ where: { id: projectId } });
  // Not found (not "not yours") for anyone but the owner — same posture as
  // every other private route in the app.
  if (!project || !userId || project.ownerId !== userId) notFound();

  const [tasks, statusOptions, priorityLevelOptions] = await Promise.all([
    prisma.task.findMany({
      where: { privateProjectId: project.id, createdById: userId, isPrivate: true },
      include: TASK_INCLUDE,
      orderBy: { createdAt: "desc" },
    }),
    getTaskStatusOptions(),
    getPriorityLevelOptions(),
  ]);

  const visibleTasks =
    !priorityFilter || priorityFilter === "ALL"
      ? tasks
      : tasks.filter((t) => (priorityFilter === "NONE" ? !t.priorityLevelId : t.priorityLevelId === priorityFilter));

  return (
    <div>
      <Link href="/my-tasks/private" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Private
      </Link>

      <div className="mt-2">
        <PrivateProjectHeader projectId={project.id} label={project.label} />
      </div>

      {tasks.length > 0 ? (
        <div className="mt-4">
          <PrivatePriorityFilter priorityLevelOptions={priorityLevelOptions} />
        </div>
      ) : null}

      <Card className={tasks.length > 0 ? "mt-3" : "mt-4"}>
        <CardContent className="p-0">
          {visibleTasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title={tasks.length === 0 ? "No tasks in this project yet" : "No tasks match this priority"}
              description={tasks.length === 0 ? "Add one below." : undefined}
            />
          ) : (
            <div className="divide-y">
              {visibleTasks.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  statusOptions={statusOptions}
                  priorityLevelOptions={priorityLevelOptions}
                  delayMs={Math.min(i * 40, 400)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <PrivateTaskQuickAdd currentUserId={userId} privateProjectId={project.id} />
    </div>
  );
}
