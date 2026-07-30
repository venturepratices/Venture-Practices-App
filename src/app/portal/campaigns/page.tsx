import { redirect } from "next/navigation";
import Link from "next/link";

import { getClientUserSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { CAMPAIGN_STAGE_VALUES, campaignLabel, type CampaignStageValue } from "@/lib/campaign-stage";
import { formatDate as formatDateInTz } from "@/lib/utils";
import { CampaignStepper } from "@/components/programs/campaign-stepper";

function formatDate(date: Date | null) {
  return date ? formatDateInTz(date, { month: "short", day: "numeric", year: "numeric" }) : "Not set";
}

/**
 * Client-portal campaign list (Slice 5) — flat, same shape as the agency
 * side's /clients/[clientId]/campaigns now that Program has been removed.
 * Shows stage progress (via the already-presentational CampaignStepper) and
 * dates only — no task titles, no assignee names.
 */
export default async function PortalCampaignsPage() {
  const clientUser = await getClientUserSession();
  if (!clientUser) redirect("/login");

  const campaigns = await prisma.campaign.findMany({
    where: { clientId: clientUser.clientId },
    include: { tasks: { select: { status: true, campaignStage: true } } },
    orderBy: { sequenceNumber: "asc" },
  });

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">My campaigns</h1>
      <p className="mt-1 text-sm text-muted-foreground">Where each of your mailings is in the process.</p>

      {campaigns.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">Nothing here yet — check back soon.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {campaigns.map((campaign) => {
            const taskCounts = CAMPAIGN_STAGE_VALUES.reduce<Record<string, { total: number; complete: number }>>((acc, stage) => {
              const stageTasks = campaign.tasks.filter((t) => (t.campaignStage ?? "PLANNING") === stage);
              acc[stage] = { total: stageTasks.length, complete: stageTasks.filter((t) => t.status === "COMPLETE").length };
              return acc;
            }, {});

            return (
              <Link
                key={campaign.id}
                href={`/portal/campaigns/${campaign.id}`}
                className="block rounded-lg border p-4 transition-colors hover:border-primary"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{campaignLabel(campaign)}</p>
                  <p className="text-xs text-muted-foreground">Mails {formatDate(campaign.mailDate)}</p>
                </div>
                <div className="mt-3">
                  <CampaignStepper currentStage={campaign.currentStage as CampaignStageValue} taskCounts={taskCounts} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
