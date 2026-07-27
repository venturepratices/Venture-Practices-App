import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ListChecks } from "lucide-react";

import { canUseCapability, requireClientAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { CAMPAIGN_STAGE_LABELS } from "@/lib/campaign-stage";
import { EmptyState } from "@/components/ui/empty-state";
import { StageSelect } from "@/components/programs/stage-select";

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; programId: string; campaignId: string }>;
}) {
  const { clientId, programId, campaignId } = await params;

  try {
    await requireClientAccess(clientId);
  } catch {
    notFound();
  }
  if (!(await canUseCapability("canViewDirectMail"))) notFound();
  const canManage = await canUseCapability("canManageDirectMail");

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, programId, program: { clientId } },
    include: {
      program: { select: { id: true, name: true } },
      tasks: {
        include: { assignees: { include: { teamMember: { select: { name: true } } } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!campaign) notFound();

  const tasksByStage = campaign.tasks.reduce<Record<string, typeof campaign.tasks>>((acc, task) => {
    const key = task.campaignStage ?? "PLANNING";
    (acc[key] ??= []).push(task);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl">
      <Link
        href={`/clients/${clientId}/programs/${programId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        {campaign.program.name}
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Campaign #{campaign.sequenceNumber}</h2>
        <StageSelect campaignId={campaign.id} currentStage={campaign.currentStage} canManage={canManage} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Mail date</p>
          <p className="text-sm font-medium">{formatDate(campaign.mailDate)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Creative due</p>
          <p className="text-sm font-medium">{formatDate(campaign.creativeDueDate)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Approval due</p>
          <p className="text-sm font-medium">{formatDate(campaign.approvalDueDate)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Print due</p>
          <p className="text-sm font-medium">{formatDate(campaign.printDueDate)}</p>
        </div>
        {campaign.quantity != null ? (
          <div>
            <p className="text-xs text-muted-foreground">Quantity</p>
            <p className="text-sm font-medium">{campaign.quantity.toLocaleString()}</p>
          </div>
        ) : null}
        {campaign.budgetCents != null ? (
          <div>
            <p className="text-xs text-muted-foreground">Budget</p>
            <p className="text-sm font-medium">{formatCurrency(campaign.budgetCents)}</p>
          </div>
        ) : null}
        {campaign.geography ? (
          <div>
            <p className="text-xs text-muted-foreground">Geography</p>
            <p className="text-sm font-medium">{campaign.geography}</p>
          </div>
        ) : null}
        {campaign.offer ? (
          <div>
            <p className="text-xs text-muted-foreground">Offer</p>
            <p className="text-sm font-medium">{campaign.offer}</p>
          </div>
        ) : null}
        {campaign.cta ? (
          <div>
            <p className="text-xs text-muted-foreground">Call to action</p>
            <p className="text-sm font-medium">{campaign.cta}</p>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-muted-foreground">Tasks</h3>
        {campaign.tasks.length === 0 ? (
          <div className="mt-2 rounded-lg border">
            <EmptyState
              icon={ListChecks}
              title="No tasks attached yet."
              description="Attach a task to this campaign from the task's detail panel."
              className="py-6"
            />
          </div>
        ) : (
          <div className="mt-2 space-y-4">
            {Object.entries(tasksByStage).map(([stage, tasks]) => (
              <div key={stage}>
                <p className="text-xs font-medium text-muted-foreground">{CAMPAIGN_STAGE_LABELS[stage as keyof typeof CAMPAIGN_STAGE_LABELS] ?? stage}</p>
                <div className="mt-1 rounded-lg border divide-y">
                  {tasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span>{task.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {task.assignees.map((a) => a.teamMember.name).join(", ") || "Unassigned"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
