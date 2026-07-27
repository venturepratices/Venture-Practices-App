import { Check } from "lucide-react";

import { CAMPAIGN_STAGE_LABELS, CAMPAIGN_STAGE_VALUES, type CampaignStageValue } from "@/lib/campaign-stage";
import { cn } from "@/lib/utils";

type StageCounts = { total: number; complete: number };

/** Presentational only — the campaign's own currentStage (advanced by src/lib/campaign-advance.ts) drives the highlight. */
export function CampaignStepper({
  currentStage,
  taskCounts,
}: {
  currentStage: CampaignStageValue;
  taskCounts: Record<string, StageCounts>;
}) {
  const currentIndex = CAMPAIGN_STAGE_VALUES.indexOf(currentStage);

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-max items-start">
        {CAMPAIGN_STAGE_VALUES.map((stage, index) => {
          const counts = taskCounts[stage];
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          return (
            <div key={stage} className="flex items-start last:flex-none">
              <div className="flex w-20 shrink-0 flex-col items-center gap-1.5 text-center">
                <div
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    isComplete && "bg-status-success text-status-success-foreground",
                    isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                    !isComplete && !isCurrent && "bg-muted text-muted-foreground"
                  )}
                >
                  {isComplete ? <Check className="size-3.5" /> : index + 1}
                </div>
                <p className={cn("text-xs font-medium", isCurrent ? "text-foreground" : "text-muted-foreground")}>
                  {CAMPAIGN_STAGE_LABELS[stage]}
                </p>
                {counts && counts.total > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {counts.complete}/{counts.total}
                  </p>
                ) : null}
              </div>
              {index < CAMPAIGN_STAGE_VALUES.length - 1 ? (
                <div className={cn("mt-3.5 h-0.5 w-6 shrink-0", isComplete ? "bg-status-success" : "bg-muted")} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
