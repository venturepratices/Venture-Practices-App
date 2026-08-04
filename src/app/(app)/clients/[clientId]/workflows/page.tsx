import { notFound } from "next/navigation";
import { GitBranch, Plus } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/info-tip";
import { NewWorkflowDialog } from "@/components/workflows/new-workflow-dialog";
import { WorkflowFolderSidebar } from "@/components/workflows/workflow-folder-sidebar";
import { WorkflowFolderToggleButton } from "@/components/workflows/workflow-folder-toggle-button";
import { WorkflowInstanceCard } from "@/components/workflows/workflow-instance-card";
import { WorkflowSidebarProvider } from "@/components/workflows/workflow-sidebar-context";

export default async function ClientWorkflowsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ folderId?: string }>;
}) {
  const { clientId } = await params;
  const { folderId } = await searchParams;
  // Client-access is enforced by the layout; this adds the Workflows capability.
  if (!(await canUseCapability("canViewWorkflows"))) notFound();
  const canManage = await canUseCapability("canManageWorkflows");

  const [instances, templates, folderRows, folderCounts, allCount] = await Promise.all([
    prisma.workflowInstance.findMany({
      where: { clientId, ...(folderId ? { folderId } : {}) },
      include: {
        client: { select: { id: true, name: true } },
        tasks: {
          select: {
            statusOption: { select: { isComplete: true } },
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
    prisma.workflowFolder.findMany({ where: { clientId }, orderBy: { name: "asc" } }),
    prisma.workflowInstance.groupBy({ by: ["folderId"], where: { clientId }, _count: { _all: true } }),
    prisma.workflowInstance.count({ where: { clientId } }),
  ]);

  const folders = folderRows.map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    count: folderCounts.find((c) => c.folderId === f.id)?._count._all ?? 0,
  }));

  const emptyMessage = folderId ? "No projects in this folder yet." : "No projects yet.";

  return (
    <div className="-m-6 flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Projects
          <InfoTip>
            A running instance of a Project Template — a staged pipeline of tasks. As each stage's tasks all
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
                New project
              </Button>
            }
          />
        ) : null}
      </div>

      <WorkflowSidebarProvider>
        <div className="flex min-h-0 flex-1">
          <WorkflowFolderSidebar clientId={clientId} folders={folders} allCount={allCount} canManage={canManage} />

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <WorkflowFolderToggleButton />

            {instances.length === 0 ? (
              <EmptyState icon={GitBranch} title={emptyMessage} description="Start one from a template — or start blank — to see it here." className="py-6" />
            ) : (
              <div className="space-y-3">
                {instances.map((instance) => (
                  <WorkflowInstanceCard key={instance.id} instance={instance} href={`/clients/${clientId}/workflows/${instance.id}`} hideClientLabel />
                ))}
              </div>
            )}
          </div>
        </div>
      </WorkflowSidebarProvider>
    </div>
  );
}
