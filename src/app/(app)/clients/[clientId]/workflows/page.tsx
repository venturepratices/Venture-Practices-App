import { notFound } from "next/navigation";
import { GitBranch, Plus } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/info-tip";
import { NewWorkflowDialog } from "@/components/workflows/new-workflow-dialog";
import { WorkflowInstanceCard } from "@/components/workflows/workflow-instance-card";

export default async function ClientWorkflowsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  // Client-access is enforced by the layout; this adds the Workflows capability.
  if (!(await canUseCapability("canViewWorkflows"))) notFound();
  const canManage = await canUseCapability("canManageWorkflows");

  const [instances, templates] = await Promise.all([
    prisma.workflowInstance.findMany({
      where: { clientId },
      include: { client: { select: { id: true, name: true } }, tasks: { select: { status: true, workflowStageNumber: true } } },
      orderBy: { createdAt: "desc" },
    }),
    canManage
      ? prisma.workflowTemplate.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Workflows
          <InfoTip>
            A running instance of a Workflow Template — a staged pipeline of tasks. As each stage's tasks all
            complete, the next stage's assignees get notified it's their turn.
          </InfoTip>
        </h2>
        {canManage ? (
          <NewWorkflowDialog
            templates={templates}
            fixedClientId={clientId}
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
          <EmptyState icon={GitBranch} title="No workflows yet." description="Start one from a template to see it here." className="py-6" />
        ) : (
          instances.map((instance) => (
            <WorkflowInstanceCard key={instance.id} instance={instance} href={`/clients/${clientId}/workflows/${instance.id}`} hideClientLabel />
          ))
        )}
      </div>
    </div>
  );
}
