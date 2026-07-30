import Link from "next/link";

import { campaignLabel } from "@/lib/campaign-stage";
import { formatDate as formatDateInTz } from "@/lib/utils";
import { StageSelect } from "@/components/programs/stage-select";

type CampaignRowData = {
  id: string;
  sequenceNumber: number;
  name?: string | null;
  mailDate: Date | string | null;
  creativeDueDate: Date | string | null;
  approvalDueDate: Date | string | null;
  printDueDate: Date | string | null;
  currentStage: string;
  tasks?: { id: string }[];
};

function formatDate(date: Date | string | null) {
  return date ? formatDateInTz(date, { month: "short", day: "numeric", year: "numeric" }) : "Not set";
}

export function CampaignRow({
  clientId,
  campaign,
  canManage,
}: {
  clientId: string;
  campaign: CampaignRowData;
  canManage: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <Link href={`/clients/${clientId}/campaigns/${campaign.id}`} className="min-w-0 flex-1">
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
