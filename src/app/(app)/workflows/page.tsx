import { notFound } from "next/navigation";
import Link from "next/link";
import { GitBranch, Plus } from "lucide-react";

import { accessibleClientFilter, canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/info-tip";
import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NewWorkflowDialog } from "@/components/workflows/new-workflow-dialog";
import { WorkflowPipeline } from "@/components/workflows/workflow-pipeline";
import type { StagesSnapshot } from "@/lib/workflow-instance";

const STATUS_TONE: Record<string, StatusTone> = { ACTIVE: "blue", COMPLETE: "success", CANCELLED: "slate" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", COMPLETE: "Complete", CANCELLED: "Cancelled" };

export default async function WorkflowsPage() {
  if (!(await canUseCapability("canViewWorkflows"))) notFound();
  const canManage = await canUseCapability("canManageWorkflows");

  const clientFilter = await accessibleClientFilter("clientId");
  const scopedWhere = Object.keys(clientFilter).length === 0 ? {} : { OR: [{ clientId: null }, clientFilter] };

  const [instances, templates, clients] = await Promise.all([
    prisma.workflowInstance.findMany({
      where: scopedWhere,
      include: { client: { select: { id: true, name: true } }, tasks: { select: { status: true, workflowStageNumber: true } } },
      orderBy: { createdAt: "desc" },
    }),
    canManage
      ? prisma.workflowTemplate.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    canManage ? prisma.client.findMany({ where: clientFilter, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Workflows
            <InfoTip>
              A running instance of a Workflow Template — a staged pipeline of tasks. As each stage's tasks all
              complete, the next stage's assignees get notified it's their turn.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">In-flight and finished workflows across the agency.</p>
        </div>
        {canManage ? (
          <NewWorkflowDialog
            templates={templates}
            clients={clients}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                New workflow
              </Button>
            }
          />
        ) : null}
      </div>

      <div className="mt-6 space-y-3">
        {instances.length === 0 ? (
          <div className="rounded-lg border">
            <EmptyState icon={GitBranch} title="No workflows yet." description="Start one from a template to see it here." />
          </div>
        ) : (
          instances.map((instance) => {
            const snapshot = instance.stagesSnapshot as StagesSnapshot;
            const taskCounts = snapshot.reduce<Record<number, { total: number; complete: number }>>((acc, stage) => {
              const stageTasks = instance.tasks.filter((t) => t.workflowStageNumber === stage.sequenceNumber);
              acc[stage.sequenceNumber] = { total: stageTasks.length, complete: stageTasks.filter((t) => t.status === "COMPLETE").length };
              return acc;
            }, {});
            const totalTasks = instance.tasks.length;
            const completeTasks = instance.tasks.filter((t) => t.status === "COMPLETE").length;

            return (
              <Link
                key={instance.id}
                href={`/workflows/${instance.id}`}
                className="block rounded-lg border p-4 transition-colors hover:border-primary"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{instance.name}</p>
                    <StatusPillBase tone={STATUS_TONE[instance.status]} label={STATUS_LABEL[instance.status]} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {instance.client ? instance.client.name : "Internal"}
                    {totalTasks > 0 ? ` · ${completeTasks}/${totalTasks} tasks done` : ""}
                  </p>
                </div>
                <div className="mt-3">
                  <WorkflowPipeline
                    stages={snapshot}
                    currentStageNumber={instance.currentStageNumber}
                    isComplete={instance.status === "COMPLETE"}
                    taskCounts={taskCounts}
                  />
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
