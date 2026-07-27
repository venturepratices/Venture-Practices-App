import Link from "next/link";

import { campaignLabel } from "@/lib/campaign-stage";
import { StageSelect } from "@/components/programs/stage-select";

type CampaignRowData = {
  id: string;
  sequenceNumber: number;
  name?: string | null;
  mailDate: Date | string;
  creativeDueDate: Date | string;
  approvalDueDate: Date | string;
  printDueDate: Date | string;
  currentStage: string;
  tasks?: { id: string }[];
};

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function CampaignRow({
  clientId,
  programId,
  campaign,
  canManage,
}: {
  clientId: string;
  programId: string;
  campaign: CampaignRowData;
  canManage: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <Link href={`/clients/${clientId}/programs/${programId}/campaigns/${campaign.id}`} className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{campaignLabel(campaign)}</p>
        <p className="text-xs text-muted-foreground">
          Mails {formatDate(campaign.mailDate)} · Creative due {formatDate(campaign.creativeDueDate)} · Approval due{" "}
          {formatDate(campaign.approvalDueDate)} · Print due {formatDate(campaign.printDueDate)}
          {campaign.tasks ? ` · ${campaign.tasks.length} task${campaign.tasks.length === 1 ? "" : "s"}` : ""}
        </p>
      </Link>
      <StageSelect campaignId={campaign.id} currentStage={campaign.currentStage} canManage={canManage} />
    </div>
  );
}
