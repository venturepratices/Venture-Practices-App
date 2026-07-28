import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { WorkflowInstanceControls } from "@/components/workflows/workflow-instance-controls";
import { WORKFLOW_STATUS_LABEL, WORKFLOW_STATUS_TONE } from "@/components/workflows/workflow-instance-card";
import { WorkflowPipeline } from "@/components/workflows/workflow-pipeline";
import { TaskListHeader, TaskRow } from "@/components/tasks/task-row";
import { StatusPillBase } from "@/components/ui/status-pill";
import type { StagesSnapshot } from "@/lib/workflow-instance";
import type { Prisma } from "@/generated/prisma/client";

export type WorkflowInstanceDetailData = Prisma.WorkflowInstanceGetPayload<{
  include: {
    client: { select: { id: true; name: true } };
    workflowTemplate: { select: { id: true; name: true } };
    createdBy: { select: { id: true; name: true } };
    tasks: {
      include: {
        assignees: { include: { teamMember: { select: { id: true; name: true } } } };
        client: { select: { id: true; name: true } };
      };
    };
  };
}>;

/**
 * Full detail body shared by the internal /workflows/[instanceId] page and
 * each client's own Workflows tab detail page — header, controls, pipeline
 * visual, and per-stage task lists. Each thin page does its own
 * gating/fetch/404 and just renders this with the fetched data.
 */
export function WorkflowInstanceDetail({
  instance,
  canManage,
  backHref,
  backLabel,
  redirectOnDelete,
}: {
  instance: WorkflowInstanceDetailData;
  canManage: boolean;
  backHref: string;
  backLabel: string;
  redirectOnDelete: string;
}) {
  const snapshot = instance.stagesSnapshot as StagesSnapshot;
  const tasksByStage = instance.tasks.reduce<Record<number, typeof instance.tasks>>((acc, task) => {
    const key = task.workflowStageNumber ?? 0;
    (acc[key] ??= []).push(task);
    return acc;
  }, {});

  const taskCounts = snapshot.reduce<Record<number, { total: number; complete: number }>>((acc, stage) => {
    const stageTasks = tasksByStage[stage.sequenceNumber] ?? [];
    acc[stage.sequenceNumber] = { total: stageTasks.length, complete: stageTasks.filter((t) => t.status === "COMPLETE").length };
    return acc;
  }, {});

  return (
    <div className="max-w-3xl">
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        {backLabel}
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{instance.name}</h2>
          <StatusPillBase tone={WORKFLOW_STATUS_TONE[instance.status]} label={WORKFLOW_STATUS_LABEL[instance.status]} />
        </div>
        {canManage ? (
          <WorkflowInstanceControls instanceId={instance.id} instanceName={instance.name} status={instance.status} redirectOnDelete={redirectOnDelete} />
        ) : null}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {instance.client ? instance.client.name : "Internal — no client"}
        {instance.workflowTemplate ? ` · from template "${instance.workflowTemplate.name}"` : ""}
        {instance.createdBy ? ` · started by ${instance.createdBy.name}` : ""}
      </p>

      <div className="mt-4 rounded-lg border p-4">
        <WorkflowPipeline
          stages={snapshot}
          currentStageNumber={instance.currentStageNumber}
          isComplete={instance.status === "COMPLETE"}
          taskCounts={taskCounts}
        />
      </div>

      <div className="mt-6 space-y-5">
        {snapshot.map((stage) => {
          const stageTasks = tasksByStage[stage.sequenceNumber] ?? [];
          const unassignedCount = stageTasks.filter((t) => t.assignees.length === 0).length;
          return (
            <div key={stage.sequenceNumber}>
              <div className="flex items-center gap-2">
                <p className="text-base font-bold text-foreground">{stage.name}</p>
                {unassignedCount > 0 ? (
                  <span className="rounded-full bg-status-warning px-1.5 py-0.5 text-[10px] font-bold text-status-warning-foreground">
                    {unassignedCount} unassigned
                  </span>
                ) : null}
              </div>
              <div className="mt-1 rounded-lg border">
                {stageTasks.length > 0 ? (
                  <>
                    <TaskListHeader />
                    <div className="divide-y px-1.5">
                      {stageTasks.map((task) => (
                        <TaskRow key={task.id} task={task} />
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No tasks in this stage.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
