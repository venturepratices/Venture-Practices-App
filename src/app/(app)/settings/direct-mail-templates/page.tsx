import { notFound } from "next/navigation";
import { FileText, Plus } from "lucide-react";

import { canUseCapability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { NewProgramTemplateDialog } from "@/components/programs/new-program-template-dialog";
import { TemplateEditor, type ProgramTemplateWithStages } from "@/components/programs/template-editor";

export default async function DirectMailTemplatesPage() {
  if (!(await canUseCapability("canManageDirectMail"))) notFound();

  const templates = await prisma.programTemplate.findMany({
    include: {
      stages: {
        orderBy: { sequenceNumber: "asc" },
        include: { tasks: { orderBy: { sequenceNumber: "asc" } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Direct Mail Templates
            <InfoTip>
              The editable master task list per stage. Editing a template never changes programs already in flight —
              the Campaign Generator wizard copies a snapshot of the template at creation time.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Reusable stage + task blueprints for the Campaign Generator wizard.</p>
        </div>
        <NewProgramTemplateDialog
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
            <EmptyState icon={FileText} title="No templates yet." description="Create one to start building the wizard's task list." />
          </div>
        ) : (
          templates.map((template) => (
            <TemplateEditor key={template.id} template={template as ProgramTemplateWithStages} />
          ))
        )}
      </div>
    </div>
  );
}
