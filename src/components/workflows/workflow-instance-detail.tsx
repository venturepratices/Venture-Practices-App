import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { AddStageInput } from "@/components/workflows/add-stage-input";
import { WorkflowFolderSelect } from "@/components/workflows/workflow-folder-select";
import { WorkflowInstanceControls } from "@/components/workflows/workflow-instance-controls";
import { WORKFLOW_STATUS_LABEL, WORKFLOW_STATUS_TONE } from "@/components/workflows/workflow-instance-card";
import { WorkflowPipeline } from "@/components/workflows/workflow-pipeline";
import { WorkflowSummaryCard } from "@/components/workflows/workflow-summary-card";
import { NewTaskInput } from "@/components/tasks/new-task-input";
import { TaskListHeader, TaskRow } from "@/components/tasks/task-row";
import { StatusPillBase } from "@/components/ui/status-pill";
import type { StatusOptionLite } from "@/lib/task-status-utils";
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
        createdBy: { select: { id: true; name: true } };
        workflowInstance: { select: { id: true; name: true } };
        statusOption: { select: { id: true; label: true; tone: true; isComplete: true } };
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
  teamMembers = [],
  folders = [],
  recentActivity = [],
  statusOptions = [],
}: {
  instance: WorkflowInstanceDetailData;
  canManage: boolean;
  backHref: string;
  backLabel: string;
  redirectOnDelete: string;
  teamMembers?: { id: string; name: string }[];
  folders?: { id: string; name: string }[];
  recentActivity?: { id: string; description: string; createdAt: Date }[];
  statusOptions?: StatusOptionLite[];
}) {
  const snapshot = instance.stagesSnapshot as StagesSnapshot;
  const tasksByStage = instance.tasks.reduce<Record<number, typeof instance.tasks>>((acc, task) => {
    const key = task.workflowStageNumber ?? 0;
    (acc[key] ??= []).push(task);
    return acc;
  }, {});

  const taskCounts = snapshot.reduce<Record<number, { total: number; complete: number }>>((acc, stage) => {
    const stageTasks = tasksByStage[stage.sequenceNumber] ?? [];
    acc[stage.sequenceNumber] = { total: stageTasks.length, complete: stageTasks.filter((t) => t.statusOption.isComplete).length };
    return acc;
  }, {});

  return (
    <div>
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
          <div className="flex items-center gap-2">
            {instance.clientId ? <WorkflowFolderSelect instanceId={instance.id} folderId={instance.folderId} folders={folders} /> : null}
            <WorkflowInstanceControls instanceId={instance.id} instanceName={instance.name} status={instance.status} redirectOnDelete={redirectOnDelete} />
          </div>
        ) : null}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {instance.client ? instance.client.name : "Internal — no client"}
        {instance.workflowTemplate ? ` · from template "${instance.workflowTemplate.name}"` : ""}
        {instance.createdBy ? ` · started by ${instance.createdBy.name}` : ""}
      </p>

      <WorkflowSummaryCard instance={instance} recentActivity={recentActivity} />

      {snapshot.length > 0 ? (
        <div className="mt-4 rounded-lg border p-4">
          <WorkflowPipeline
            stages={snapshot}
            currentStageNumber={instance.currentStageNumber}
            isComplete={instance.status === "COMPLETE"}
            taskCounts={taskCounts}
          />
        </div>
      ) : null}

      <div className="mt-6 space-y-5">
        {snapshot.length === 0 ? (
          <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
            No stages yet — add one below to start building this project's pipeline.
          </p>
        ) : (
          snapshot.map((stage) => {
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
                          <TaskRow key={task.id} task={task} statusOptions={statusOptions} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="px-4 py-3 text-sm text-muted-foreground">No tasks in this stage.</p>
                  )}
                </div>
                {canManage && instance.status === "ACTIVE" ? (
                  <div className="mt-2">
                    <NewTaskInput
                      clientId={instance.clientId}
                      lockClient
                      teamMembers={teamMembers}
                      workflowInstanceId={instance.id}
                      workflowStageNumber={stage.sequenceNumber}
                      statusOptions={statusOptions}
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {canManage && instance.status === "ACTIVE" ? (
        <div className="mt-6">
          <AddStageInput
            instanceId={instance.id}
            existingStages={snapshot.map((s) => ({ name: s.name, description: s.description }))}
          />
        </div>
      ) : null}
    </div>
  );
}
