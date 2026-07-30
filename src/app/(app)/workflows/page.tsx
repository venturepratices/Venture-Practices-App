import { notFound } from "next/navigation";
import { GitBranch, Plus } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/info-tip";
import { Button } from "@/components/ui/button";
import { NewWorkflowDialog } from "@/components/workflows/new-workflow-dialog";
import { WorkflowInstanceCard } from "@/components/workflows/workflow-instance-card";

export default async function WorkflowsPage() {
  if (!(await canUseCapability("canViewWorkflows"))) notFound();
  const canManage = await canUseCapability("canManageWorkflows");

  const [instances, templates] = await Promise.all([
    prisma.workflowInstance.findMany({
      where: { clientId: null },
      include: {
        client: { select: { id: true, name: true } },
        tasks: {
          select: {
            status: true,
            workflowStageNumber: true,
            deadline: true,
            assignees: { include: { teamMember: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    canManage
      ? prisma.workflowTemplate.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Projects
            <InfoTip>
              Projects with no specific client — internal processes like new-hire onboarding. Client-tied projects
              now live on that client&apos;s own Projects tab.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Internal, no-client projects across the agency.</p>
        </div>
        {canManage ? (
          <NewWorkflowDialog
            templates={templates}
            fixedClientId={null}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                New project
              </Button>
            }
          />
        ) : null}
      </div>

      <div className="mt-6 space-y-3">
        {instances.length === 0 ? (
          <div className="rounded-lg border">
            <EmptyState icon={GitBranch} title="No internal projects yet." description="Start one from a template to see it here." />
          </div>
        ) : (
          instances.map((instance) => (
            <WorkflowInstanceCard key={instance.id} instance={instance} href={`/workflows/${instance.id}`} hideClientLabel />
          ))
        )}
      </div>
    </div>
  );
}
