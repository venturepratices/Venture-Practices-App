import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

type StageCounts = { total: number; complete: number };
type StageMeta = { name: string; sequenceNumber: number };

/**
 * Presentational only, dynamic on however many stages a WorkflowTemplate
 * defines (unlike CampaignStepper, which loops over a fixed 7-value enum).
 * `isComplete` (instance.status === "COMPLETE") checkmarks every stage
 * regardless of currentStageNumber, since a completed instance's
 * currentStageNumber stays pinned at the last real stage rather than
 * incrementing past it.
 */
export function WorkflowPipeline({
  stages,
  currentStageNumber,
  isComplete,
  taskCounts,
}: {
  stages: StageMeta[];
  currentStageNumber: number;
  isComplete: boolean;
  taskCounts: Record<number, StageCounts>;
}) {
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-max items-start">
        {stages.map((stage, index) => {
          const counts = taskCounts[stage.sequenceNumber];
          const stageIsComplete = isComplete || stage.sequenceNumber < currentStageNumber;
          const isCurrent = !isComplete && stage.sequenceNumber === currentStageNumber;
          return (
            <div key={stage.sequenceNumber} className="flex items-start last:flex-none">
              <div className="flex w-24 shrink-0 flex-col items-center gap-1.5 text-center">
                <div
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    stageIsComplete && "bg-status-success text-status-success-foreground",
                    isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                    !stageIsComplete && !isCurrent && "bg-muted text-muted-foreground"
                  )}
                >
                  {stageIsComplete ? <Check className="size-3.5" /> : index + 1}
                </div>
                <p className={cn("line-clamp-2 text-xs font-medium", isCurrent ? "text-foreground" : "text-muted-foreground")}>
                  {stage.name}
                </p>
                {counts && counts.total > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {counts.complete}/{counts.total}
                  </p>
                ) : null}
              </div>
              {index < stages.length - 1 ? (
                <div className={cn("mt-3.5 h-0.5 w-6 shrink-0", stageIsComplete ? "bg-status-success" : "bg-muted")} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
