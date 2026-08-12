import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";
import { WorkflowPipeline } from "@/components/workflows/workflow-pipeline";
import type { StagesSnapshot } from "@/lib/workflow-instance";
import type { Prisma } from "@/generated/prisma/client";

export const WORKFLOW_STATUS_TONE: Record<string, StatusTone> = { ACTIVE: "blue", COMPLETE: "success", CANCELLED: "slate" };
export const WORKFLOW_STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", COMPLETE: "Complete", CANCELLED: "Cancelled" };

export type WorkflowInstanceCardData = Prisma.WorkflowInstanceGetPayload<{
  include: {
    client: { select: { id: true; name: true } };
    tasks: {
      select: {
        statusOption: { select: { isComplete: true } };
        workflowStageNumber: true;
        deadline: true;
        assignees: { include: { teamMember: { select: { name: true } } } };
      };
    };
  };
}>;

function daysSince(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Clickable list row shared by the internal /workflows list and each
 * client's own Workflows tab, so the two never drift out of sync.
 */
export function WorkflowInstanceCard({
  instance,
  href,
  hideClientLabel = false,
  delayMs,
}: {
  instance: WorkflowInstanceCardData;
  href: string;
  hideClientLabel?: boolean;
  delayMs?: number;
}) {
  const snapshot = instance.stagesSnapshot as StagesSnapshot;
  const taskCounts = snapshot.reduce<Record<number, { total: number; complete: number }>>((acc, stage) => {
    const stageTasks = instance.tasks.filter((t) => t.workflowStageNumber === stage.sequenceNumber);
    acc[stage.sequenceNumber] = { total: stageTasks.length, complete: stageTasks.filter((t) => t.statusOption.isComplete).length };
    return acc;
  }, {});
  const totalTasks = instance.tasks.length;
  const completeTasks = instance.tasks.filter((t) => t.statusOption.isComplete).length;

  const metaParts: string[] = [];
  if (!hideClientLabel) metaParts.push(instance.client ? instance.client.name : "Internal");
  if (totalTasks > 0) metaParts.push(`${completeTasks}/${totalTasks} tasks done`);
  metaParts.push(`started ${daysSince(instance.createdAt)}d ago`);

  const currentStageName = snapshot.find((s) => s.sequenceNumber === instance.currentStageNumber)?.name;
  const currentStageTasks = instance.tasks.filter((t) => t.workflowStageNumber === instance.currentStageNumber && !t.statusOption.isComplete);
  const assigneeNames = [...new Set(currentStageTasks.flatMap((t) => t.assignees.map((a) => a.teamMember.name)))];
  // eslint-disable-next-line react-hooks/purity -- this is a Server Component; Date.now() here is a one-time-per-request snapshot, not a client render-purity concern (no hydration involved)
  const overdueCount = instance.tasks.filter((t) => !t.statusOption.isComplete && t.deadline && t.deadline.getTime() < Date.now()).length;

  const turnLabel =
    assigneeNames.length === 0
      ? null
      : assigneeNames.length <= 2
        ? assigneeNames.join(", ")
        : `${assigneeNames.slice(0, 2).join(", ")} +${assigneeNames.length - 2} more`;

  return (
    <Link
      href={href}
      style={{ animationDelay: delayMs ? `${delayMs}ms` : undefined }}
      className="hover-glow-ring block animate-in rounded-lg border p-4 fade-in slide-in-from-bottom-1 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-primary"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{instance.name}</p>
          <StatusPillBase tone={WORKFLOW_STATUS_TONE[instance.status]} label={WORKFLOW_STATUS_LABEL[instance.status]} />
          {overdueCount > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-status-danger px-1.5 py-0.5 text-[10px] font-bold text-status-danger-foreground">
              <AlertTriangle className="size-3" />
              {overdueCount} overdue
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{metaParts.join(" · ")}</p>
      </div>
      {instance.status === "ACTIVE" && currentStageName ? (
        <p className="mt-1 text-xs text-muted-foreground">
          On: <span className="font-medium text-foreground">{currentStageName}</span>
          {turnLabel ? (
            <>
              {" "}
              · waiting on <span className="font-medium text-foreground">{turnLabel}</span>
            </>
          ) : null}
        </p>
      ) : null}
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
