import { notFound } from "next/navigation";
import { GitBranch, Plus } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getTaskStatusOptions } from "@/lib/task-status";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { NewWorkflowTemplateDialog } from "@/components/workflows/new-workflow-template-dialog";
import { TemplateFolderSidebar } from "@/components/workflows/template-folder-sidebar";
import { WorkflowTemplateCard } from "@/components/workflows/workflow-template-card";
import type { WorkflowTemplateWithStages } from "@/components/workflows/workflow-template-dialog";

export default async function WorkflowTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ folderId?: string }>;
}) {
  if (!(await canUseCapability("canManageWorkflows"))) notFound();

  const { folderId } = await searchParams;

  const [templates, folders, totalCount, teamMembers, statusOptions] = await Promise.all([
    prisma.workflowTemplate.findMany({
      // Selection is URL-driven (?folderId=) so the view is refresh-safe and
      // linkable — same convention as the per-client project/asset folders.
      where: folderId ? { folderId } : {},
      include: {
        stageTemplates: {
          orderBy: { sequenceNumber: "asc" },
          include: {
            taskTemplates: {
              orderBy: { sequenceNumber: "asc" },
              include: {
                defaultAssignees: { include: { teamMember: { select: { id: true, name: true } } } },
                links: { orderBy: { createdAt: "asc" } },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.workflowTemplateFolder.findMany({
      include: { _count: { select: { templates: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.workflowTemplate.count(),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getTaskStatusOptions(),
  ]);

  const activeFolder = folderId ? folders.find((f) => f.id === folderId) : null;
  const folderOptions = folders.map((f) => ({ id: f.id, name: f.name, color: f.color }));

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Project Templates
            <InfoTip>
              A reusable staged pipeline (e.g. Client Onboarding) — each stage carries its own task list with default
              assignees. Editing a template never changes projects already in flight; starting a project copies a
              snapshot of the template at that moment. Click a template to open its editor.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Reusable stage + task blueprints for starting new projects.</p>
        </div>
        <NewWorkflowTemplateDialog
          folderId={folderId ?? null}
          trigger={
            <Button size="sm">
              <Plus className="size-4" />
              New template
            </Button>
          }
        />
      </div>

      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        <TemplateFolderSidebar
          folders={folders.map((f) => ({ id: f.id, name: f.name, color: f.color, templateCount: f._count.templates }))}
          totalCount={totalCount}
        />

        <div className="min-w-0 flex-1">
          <p className="mb-3 text-sm font-semibold">
            {activeFolder ? activeFolder.name : "All templates"}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {templates.length} template{templates.length === 1 ? "" : "s"}
            </span>
          </p>

          {templates.length === 0 ? (
            <div className="rounded-lg border">
              <EmptyState
                icon={GitBranch}
                title={activeFolder ? "Nothing in this folder yet." : "No templates yet."}
                description={
                  activeFolder
                    ? "Move a template here from its card menu, or create a new one."
                    : "Create one to start building a reusable staged pipeline."
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((template) => (
                <WorkflowTemplateCard
                  key={template.id}
                  template={template as WorkflowTemplateWithStages}
                  teamMembers={teamMembers}
                  statusOptions={statusOptions}
                  folders={folderOptions}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
