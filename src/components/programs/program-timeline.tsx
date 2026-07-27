import Link from "next/link";

import { TONE_BG } from "@/components/dashboard/status-bar";
import {
  CAMPAIGN_STAGE_LABELS,
  CAMPAIGN_STAGE_TONES,
  CAMPAIGN_STAGE_VALUES,
  campaignLabel,
  type CampaignStageValue,
} from "@/lib/campaign-stage";

const MONTH_WIDTH = 96;
const LABEL_WIDTH = 140;

type TimelineCampaign = {
  id: string;
  sequenceNumber: number;
  name?: string | null;
  mailDate: Date | null;
  creativeDueDate: Date | null;
  currentStage: CampaignStageValue;
};

type ScheduledCampaign = TimelineCampaign & { mailDate: Date; creativeDueDate: Date };

function monthKey(date: Date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function monthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Horizontal overview of every campaign in a program, laid out by month.
 * Month-level granularity only (no day precision) — matches how due dates
 * are actually computed (a few weeks before mailDate, usually the same or
 * adjacent month), and keeps this a lightweight hand-rolled visual rather
 * than a full day-precise Gantt chart. Purely presentational: reads
 * currentStage, doesn't write anything.
 */
export function ProgramTimeline({
  campaigns,
  clientId,
  programId,
}: {
  campaigns: TimelineCampaign[];
  clientId: string;
  programId: string;
}) {
  if (campaigns.length === 0) return null;

  const scheduled: ScheduledCampaign[] = campaigns.filter(
    (c): c is ScheduledCampaign => c.mailDate != null && c.creativeDueDate != null
  );
  const unscheduledCount = campaigns.length - scheduled.length;
  if (scheduled.length === 0) {
    return <p className="text-sm text-muted-foreground">No campaigns have a mail date set yet.</p>;
  }

  const keys = scheduled.flatMap((c) => [monthKey(c.creativeDueDate), monthKey(c.mailDate)]);
  const minKey = Math.min(...keys);
  const maxKey = Math.max(...keys);
  const monthCount = maxKey - minKey + 1;
  const months = Array.from({ length: monthCount }, (_, i) => {
    const key = minKey + i;
    return new Date(Math.floor(key / 12), key % 12, 1);
  });
  const trackWidth = monthCount * MONTH_WIDTH;
  const stageCount = CAMPAIGN_STAGE_VALUES.length;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="min-w-max">
        <div className="flex">
          <div className="shrink-0 border-b px-3 py-2 text-xs font-semibold text-muted-foreground" style={{ width: LABEL_WIDTH }}>
            Campaign
          </div>
          <div className="flex shrink-0 border-b" style={{ width: trackWidth }}>
            {months.map((m, i) => (
              <div
                key={i}
                className="shrink-0 border-l px-2 py-2 text-center text-xs font-medium text-muted-foreground first:border-l-0"
                style={{ width: MONTH_WIDTH }}
              >
                {monthLabel(m)}
              </div>
            ))}
          </div>
        </div>

        {scheduled.map((campaign) => {
          const startOffset = monthKey(campaign.creativeDueDate) - minKey;
          const endOffset = monthKey(campaign.mailDate) - minKey;
          const barLeft = startOffset * MONTH_WIDTH + 4;
          const barWidth = (endOffset - startOffset + 1) * MONTH_WIDTH - 8;
          const stageIndex = CAMPAIGN_STAGE_VALUES.indexOf(campaign.currentStage);
          const dotProgress = stageCount > 1 ? stageIndex / (stageCount - 1) : 0;
          const dotLeft = barLeft + dotProgress * (barWidth - 10);

          return (
            <div key={campaign.id} className="flex items-center">
              <Link
                href={`/clients/${clientId}/programs/${programId}/campaigns/${campaign.id}`}
                className="shrink-0 truncate border-r px-3 py-2.5 text-sm font-medium hover:text-primary"
                style={{ width: LABEL_WIDTH }}
              >
                {campaignLabel(campaign)}
              </Link>
              <div className="relative shrink-0" style={{ width: trackWidth, height: 36 }}>
                <div className="absolute inset-0 flex">
                  {months.map((_, i) => (
                    <div key={i} className="shrink-0 border-l first:border-l-0" style={{ width: MONTH_WIDTH }} />
                  ))}
                </div>
                <div
                  className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted"
                  style={{ left: barLeft, width: barWidth }}
                  title={`Creative due ${formatDate(campaign.creativeDueDate)} · Mails ${formatDate(campaign.mailDate)} · ${CAMPAIGN_STAGE_LABELS[campaign.currentStage]}`}
                />
                <div
                  className={`absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full ring-2 ring-background ${TONE_BG[CAMPAIGN_STAGE_TONES[campaign.currentStage]]}`}
                  style={{ left: dotLeft }}
                  title={`${campaignLabel(campaign)} — ${CAMPAIGN_STAGE_LABELS[campaign.currentStage]}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      {unscheduledCount > 0 ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          {unscheduledCount} campaign{unscheduledCount === 1 ? "" : "s"} without a mail date yet — not shown above.
        </p>
      ) : null}
    </div>
  );
}
