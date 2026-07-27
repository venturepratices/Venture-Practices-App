import { notFound } from "next/navigation";
import { Mail, Plus } from "lucide-react";

import { canUseCapability, requireClientAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { PROGRAM_PRODUCT_LABELS, PROGRAM_STATUS_LABELS, PROGRAM_STATUS_TONES } from "@/lib/validations/program";
import { Button } from "@/components/ui/button";
import { StatusPillBase } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { CampaignRow } from "@/components/programs/campaign-row";
import { NewCampaignDialog } from "@/components/programs/new-campaign-dialog";

export default async function ProgramDetailPage({ params }: { params: Promise<{ clientId: string; programId: string }> }) {
  const { clientId, programId } = await params;

  try {
    await requireClientAccess(clientId);
  } catch {
    notFound();
  }
  if (!(await canUseCapability("canViewDirectMail"))) notFound();
  const canManage = await canUseCapability("canManageDirectMail");

  const program = await prisma.program.findFirst({
    where: { id: programId, clientId },
    include: {
      accountManager: { select: { id: true, name: true } },
      campaigns: {
        orderBy: { sequenceNumber: "asc" },
        include: { tasks: { select: { id: true } } },
      },
      tasks: {
        where: { campaignId: null },
        include: { assignee: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!program) notFound();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{program.name}</h2>
          <div className="mt-1 flex items-center gap-2">
            <StatusPillBase
              tone={PROGRAM_STATUS_TONES[program.status]}
              label={PROGRAM_STATUS_LABELS[program.status] ?? program.status}
            />
            <span className="text-sm text-muted-foreground">{PROGRAM_PRODUCT_LABELS[program.product] ?? program.product}</span>
            <span className="text-sm text-muted-foreground">· {program.accountManager?.name ?? "Unassigned"}</span>
          </div>
        </div>
        {canManage ? (
          <NewCampaignDialog
            programId={program.id}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                New campaign
              </Button>
            }
          />
        ) : null}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-muted-foreground">Campaigns</h3>
        <div className="mt-2 rounded-lg border divide-y">
          {program.campaigns.length === 0 ? (
            <EmptyState icon={Mail} title="No campaigns yet." className="py-6" />
          ) : (
            program.campaigns.map((campaign) => (
              <CampaignRow key={campaign.id} clientId={clientId} programId={program.id} campaign={campaign} canManage={canManage} />
            ))
          )}
        </div>
      </div>

      {program.tasks.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-muted-foreground">Program tasks</h3>
          <div className="mt-2 rounded-lg border divide-y">
            {program.tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>{task.title}</span>
                <span className="text-xs text-muted-foreground">{task.assignee?.name ?? "Unassigned"}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
