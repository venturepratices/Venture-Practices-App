import { notFound } from "next/navigation";
import { GitBranch, Plus } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getTaskStatusOptions } from "@/lib/task-status";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { NewWorkflowTemplateDialog } from "@/components/workflows/new-workflow-template-dialog";
import { WorkflowTemplateEditor, type WorkflowTemplateWithStages } from "@/components/workflows/workflow-template-editor";

export default async function WorkflowTemplatesPage() {
  if (!(await canUseCapability("canManageWorkflows"))) notFound();

  const [templates, teamMembers, statusOptions] = await Promise.all([
    prisma.workflowTemplate.findMany({
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
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getTaskStatusOptions(),
  ]);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Project Templates
            <InfoTip>
              A reusable staged pipeline (e.g. Client Onboarding) — each stage carries its own task list with default
              assignees. Editing a template never changes projects already in flight; starting a project copies a
              snapshot of the template at that moment.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Reusable stage + task blueprints for starting new projects.</p>
        </div>
        <NewWorkflowTemplateDialog
          trigger={
            <Button size="sm">
              <Plus className="size-4" />
              New template
            </Button>
          }
        />
      </div>

      <div className="mt-6 space-y-3">
        {templates.length === 0 ? (
          <div className="rounded-lg border">
            <EmptyState icon={GitBranch} title="No templates yet." description="Create one to start building a reusable staged pipeline." />
          </div>
        ) : (
          templates.map((template) => (
            <WorkflowTemplateEditor
              key={template.id}
              template={template as WorkflowTemplateWithStages}
              teamMembers={teamMembers}
              statusOptions={statusOptions}
            />
          ))
        )}
      </div>
    </div>
  );
}
