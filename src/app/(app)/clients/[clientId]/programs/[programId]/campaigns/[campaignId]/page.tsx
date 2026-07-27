import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { canUseCapability, requireClientAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { CAMPAIGN_STAGE_LABELS, CAMPAIGN_STAGE_VALUES } from "@/lib/campaign-stage";
import { CampaignStepper } from "@/components/programs/campaign-stepper";
import { StageSelect } from "@/components/programs/stage-select";
import { NewTaskInput } from "@/components/tasks/new-task-input";
import { TaskListHeader, TaskRow } from "@/components/tasks/task-row";

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

  const [campaign, teamMembers] = await Promise.all([
    prisma.campaign.findFirst({
      where: { id: campaignId, programId, program: { clientId } },
      include: {
        program: { select: { id: true, name: true } },
        tasks: {
          include: {
            assignees: { include: { teamMember: { select: { id: true, name: true } } } },
            client: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.teamMember.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!campaign) notFound();

  const tasksByStage = campaign.tasks.reduce<Record<string, typeof campaign.tasks>>((acc, task) => {
    const key = task.campaignStage ?? "PLANNING";
    (acc[key] ??= []).push(task);
    return acc;
  }, {});

  const taskCounts = CAMPAIGN_STAGE_VALUES.reduce<Record<string, { total: number; complete: number }>>((acc, stage) => {
    const stageTasks = tasksByStage[stage] ?? [];
    acc[stage] = { total: stageTasks.length, complete: stageTasks.filter((t) => t.status === "COMPLETE").length };
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

      <div className="mt-4 rounded-lg border p-4">
        <CampaignStepper currentStage={campaign.currentStage} taskCounts={taskCounts} />
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
        <p className="mt-0.5 text-xs text-muted-foreground">
          Completing every task in a stage automatically advances the campaign to the next one.
        </p>

        <div className="mt-3 space-y-5">
          {CAMPAIGN_STAGE_VALUES.map((stage) => {
            const stageTasks = tasksByStage[stage] ?? [];
            return (
              <div key={stage}>
                <p className="text-xs font-medium text-muted-foreground">{CAMPAIGN_STAGE_LABELS[stage]}</p>
                <div className="mt-1 rounded-lg border">
                  {stageTasks.length > 0 ? (
                    <>
                      <TaskListHeader />
                      <div className="divide-y px-1.5">
                        {stageTasks.map((task) => (
                          <TaskRow key={task.id} task={task} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="px-4 py-3 text-sm text-muted-foreground">No tasks yet.</p>
                  )}
                  {canManage ? (
                    <div className="border-t p-2">
                      <NewTaskInput
                        clientId={clientId}
                        lockClient
                        teamMembers={teamMembers}
                        programId={campaign.programId}
                        campaignId={campaign.id}
                        campaignStage={stage}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
