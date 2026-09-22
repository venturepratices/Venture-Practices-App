import Link from "next/link";
import { ChevronRight, Lock } from "lucide-react";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTaskStatusOptions } from "@/lib/task-status";
import { getPriorityLevelOptions } from "@/lib/priority-level";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PrivateProjectQuickAdd } from "@/components/tasks/private-project-quick-add";
import { PrivatePriorityFilter } from "@/components/tasks/private-priority-filter";
import { PrivateTabToggle } from "@/components/tasks/private-tab-toggle";
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

export default async function PrivateTasksProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; priorityLevelId?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const params = await searchParams;
  const tab = params.tab === "tasks" ? "tasks" : "projects";

  const [projects, allPrivateTasks, statusOptions, priorityLevelOptions] = await Promise.all([
    userId
      ? prisma.privateProject.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    // One query for every one of the viewer's private tasks — grouped below
    // into "standalone" vs "per project" in memory rather than N+1 queries,
    // since this is a small, per-person data set (not paginated).
    userId
      ? prisma.task.findMany({
          where: { createdById: userId, isPrivate: true },
          include: TASK_INCLUDE,
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    getTaskStatusOptions(),
    getPriorityLevelOptions(),
  ]);

  const standaloneTasks = allPrivateTasks.filter((t) => !t.privateProjectId);
  // Filters the Tasks panel's own list only — the toggle's badge count above
  // and the Projects panel's "X of Y done" counts always reflect true totals,
  // not whatever priority happens to be filtered right now.
  const priorityFilter = params.priorityLevelId;
  const visibleStandaloneTasks =
    !priorityFilter || priorityFilter === "ALL"
      ? standaloneTasks
      : standaloneTasks.filter((t) => (priorityFilter === "NONE" ? !t.priorityLevelId : t.priorityLevelId === priorityFilter));
  const tasksByProject = new Map<string, typeof allPrivateTasks>();
  for (const task of allPrivateTasks) {
    if (!task.privateProjectId) continue;
    const list = tasksByProject.get(task.privateProjectId) ?? [];
    list.push(task);
    tasksByProject.set(task.privateProjectId, list);
  }

  return (
    <div>
      <p className="flex items-center gap-2 text-muted-foreground">
        <Lock className="size-3.5 shrink-0" />
        Only visible to you — nobody else, not even admins, can see this tab or anything you add here.
      </p>

      <div className="mt-4">
        <PrivateTabToggle tab={tab} projectCount={projects.length} taskCount={standaloneTasks.length} />
      </div>

      {tab === "projects" ? (
        <div className="mt-4">
          <Card>
            <CardContent className="p-0">
              {projects.length === 0 ? (
                <EmptyState icon={Lock} title="No private projects yet" description="Group your own private tasks under a project to keep them organized." />
              ) : (
                <div className="divide-y">
                  {projects.map((project) => {
                    const tasks = tasksByProject.get(project.id) ?? [];
                    const done = tasks.filter((t) => t.statusOption.isComplete).length;
                    const isComplete = tasks.length > 0 && done === tasks.length;
                    return (
                      <Link
                        key={project.id}
                        href={`/my-tasks/private/${project.id}`}
                        className="flex items-center gap-2.5 px-4 py-3 text-sm transition-colors hover:bg-muted"
                      >
                        <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium">{project.label}</span>
                        <span className={isComplete ? "text-xs font-semibold text-emerald-600 dark:text-emerald-400" : "text-xs text-muted-foreground"}>
                          {tasks.length === 0 ? "No tasks yet" : isComplete ? "Complete" : `${done} of ${tasks.length} done`}
                        </span>
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          <PrivateProjectQuickAdd />
        </div>
      ) : (
        <div className="mt-4">
          <PrivatePriorityFilter priorityLevelOptions={priorityLevelOptions} />
          <Card className="mt-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="size-4" />
                Private tasks
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {visibleStandaloneTasks.length === 0 ? (
                <EmptyState
                  icon={Lock}
                  title={standaloneTasks.length === 0 ? "No private tasks yet" : "No tasks match this priority"}
                  description={standaloneTasks.length === 0 ? "Add one below, or add tasks from inside a private project." : undefined}
                />
              ) : (
                <div className="divide-y">
                  {visibleStandaloneTasks.map((task, i) => (
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
          {userId ? <PrivateTaskQuickAdd currentUserId={userId} /> : null}
        </div>
      )}
    </div>
  );
}
