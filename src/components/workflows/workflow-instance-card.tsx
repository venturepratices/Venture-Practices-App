import Link from "next/link";

import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";
import { WorkflowPipeline } from "@/components/workflows/workflow-pipeline";
import type { StagesSnapshot } from "@/lib/workflow-instance";
import type { Prisma } from "@/generated/prisma/client";

export const WORKFLOW_STATUS_TONE: Record<string, StatusTone> = { ACTIVE: "blue", COMPLETE: "success", CANCELLED: "slate" };
export const WORKFLOW_STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", COMPLETE: "Complete", CANCELLED: "Cancelled" };

export type WorkflowInstanceCardData = Prisma.WorkflowInstanceGetPayload<{
  include: {
    client: { select: { id: true; name: true } };
    tasks: { select: { status: true; workflowStageNumber: true } };
  };
}>;

/**
 * Clickable list row shared by the internal /workflows list and each
 * client's own Workflows tab, so the two never drift out of sync.
 */
export function WorkflowInstanceCard({
  instance,
  href,
  hideClientLabel = false,
}: {
  instance: WorkflowInstanceCardData;
  href: string;
  hideClientLabel?: boolean;
}) {
  const snapshot = instance.stagesSnapshot as StagesSnapshot;
  const taskCounts = snapshot.reduce<Record<number, { total: number; complete: number }>>((acc, stage) => {
    const stageTasks = instance.tasks.filter((t) => t.workflowStageNumber === stage.sequenceNumber);
    acc[stage.sequenceNumber] = { total: stageTasks.length, complete: stageTasks.filter((t) => t.status === "COMPLETE").length };
    return acc;
  }, {});
  const totalTasks = instance.tasks.length;
  const completeTasks = instance.tasks.filter((t) => t.status === "COMPLETE").length;

  const metaParts: string[] = [];
  if (!hideClientLabel) metaParts.push(instance.client ? instance.client.name : "Internal");
  if (totalTasks > 0) metaParts.push(`${completeTasks}/${totalTasks} tasks done`);

  return (
    <Link href={href} className="block rounded-lg border p-4 transition-colors hover:border-primary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{instance.name}</p>
          <StatusPillBase tone={WORKFLOW_STATUS_TONE[instance.status]} label={WORKFLOW_STATUS_LABEL[instance.status]} />
        </div>
        {metaParts.length > 0 ? <p className="text-xs text-muted-foreground">{metaParts.join(" · ")}</p> : null}
      </div>
      <div className="mt-3">
        <WorkflowPipeline
          stages={snapshot}
          currentStageNumber={instance.currentStageNumber}
          isComplete={instance.status === "COMPLETE"}
          taskCounts={taskCounts}
        />
      </div>
    </Link>
  );
}
