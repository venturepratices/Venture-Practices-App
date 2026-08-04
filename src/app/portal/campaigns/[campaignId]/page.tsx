import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getClientUserSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { CAMPAIGN_STAGE_VALUES, campaignLabel, type CampaignStageValue } from "@/lib/campaign-stage";
import { formatDate as formatDateInTz } from "@/lib/utils";
import { CampaignStepper } from "@/components/programs/campaign-stepper";

function formatDate(date: Date | null) {
  return date ? formatDateInTz(date, { month: "long", day: "numeric", year: "numeric" }) : "Not set";
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/**
 * Client-portal campaign detail (Slice 5). Same stage/date/quantity/budget
 * info the agency side shows, plus a link to the proof asset once one's
 * linked — but deliberately NO task list, NO assignee names. The client
 * sees progress, not our internal to-do list.
 */
export default async function PortalCampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const clientUser = await getClientUserSession();
  if (!clientUser) redirect("/login");

  const { campaignId } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, clientId: clientUser.clientId },
    include: {
      proofAsset: { select: { id: true, status: true } },
      tasks: { select: { statusOption: { select: { isComplete: true } }, campaignStage: true } },
    },
  });
  if (!campaign) notFound();

  const taskCounts = CAMPAIGN_STAGE_VALUES.reduce<Record<string, { total: number; complete: number }>>((acc, stage) => {
    const stageTasks = campaign.tasks.filter((t) => (t.campaignStage ?? "PLANNING") === stage);
    acc[stage] = { total: stageTasks.length, complete: stageTasks.filter((t) => t.statusOption.isComplete).length };
    return acc;
  }, {});

  return (
    <div className="max-w-2xl p-6">
      <Link href="/portal/campaigns" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        My campaigns
      </Link>

      <h1 className="mt-2 text-lg font-semibold">{campaignLabel(campaign)}</h1>

      <div className="mt-4 rounded-lg border p-4">
        <CampaignStepper currentStage={campaign.currentStage as CampaignStageValue} taskCounts={taskCounts} />
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
      </div>

      {campaign.proofAsset ? (
        <div className="mt-4 rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Proof for this mailing</p>
          <Link href={`/portal/assets/${campaign.proofAsset.id}`} className="text-sm font-medium hover:text-primary">
            {campaign.proofAsset.status === "APPROVED" ? "View approved proof" : "Review the proof"} →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
