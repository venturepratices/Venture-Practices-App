import { AlertTriangle, Clock3, History } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { StagesSnapshot } from "@/lib/workflow-instance";
import type { WorkflowInstanceDetailData } from "@/components/workflows/workflow-instance-detail";

type ActivityEntry = { id: string; description: string; createdAt: Date };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Static, server-rendered "what's going on right now" summary — current
 * stage progress, whose turn it is, overdue/due-soon tasks, and recent
 * activity — sitting above the pipeline on every workflow instance's detail
 * page. Pure read of data the page already fetched; zero client JS, always
 * current on refresh. An AI-generated natural-language version is a possible
 * future upgrade (noted in the plan) once this static version proves useful.
 */
export function WorkflowSummaryCard({ instance, recentActivity }: { instance: WorkflowInstanceDetailData; recentActivity: ActivityEntry[] }) {
  if (instance.status !== "ACTIVE") return null;

  const now = new Date();
  const snapshot = instance.stagesSnapshot as StagesSnapshot;
  const currentStage = snapshot.find((s) => s.sequenceNumber === instance.currentStageNumber);
  const currentStageTasks = instance.tasks.filter((t) => t.workflowStageNumber === instance.currentStageNumber);
  const completeInStage = currentStageTasks.filter((t) => t.status === "COMPLETE").length;
  const progressPct = currentStageTasks.length > 0 ? Math.round((completeInStage / currentStageTasks.length) * 100) : 0;

  const whoseTurn = currentStageTasks
    .filter((t) => t.status !== "COMPLETE")
    .sort((a, b) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity));

  const overdue = instance.tasks
    .filter((t) => t.status !== "COMPLETE" && t.deadline && t.deadline.getTime() < now.getTime())
    .sort((a, b) => a.deadline!.getTime() - b.deadline!.getTime());

  const dueSoonCutoff = now.getTime() + 3 * MS_PER_DAY;
  const dueSoon = instance.tasks
    .filter((t) => t.status !== "COMPLETE" && t.deadline && t.deadline.getTime() >= now.getTime() && t.deadline.getTime() <= dueSoonCutoff)
    .sort((a, b) => a.deadline!.getTime() - b.deadline!.getTime());

  function assigneeNames(task: WorkflowInstanceDetailData["tasks"][number]) {
    return task.assignees.length > 0 ? task.assignees.map((a) => a.teamMember.name).join(", ") : "Unassigned";
  }

  return (
    <Card size="sm" className="mt-4">
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Current stage</p>
          <p className="mt-1 text-sm font-semibold">{currentStage?.name ?? "—"}</p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {completeInStage}/{currentStageTasks.length} tasks done in this stage
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Whose turn</p>
          {whoseTurn.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Nothing pending in this stage.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {whoseTurn.slice(0, 4).map((t) => (
                <li key={t.id} className="truncate text-sm">
                  <span className="font-medium">{assigneeNames(t)}</span>
                  <span className="text-muted-foreground"> — {t.title}</span>
                </li>
              ))}
              {whoseTurn.length > 4 ? <li className="text-xs text-muted-foreground">+{whoseTurn.length - 4} more</li> : null}
            </ul>
          )}
        </div>

        {overdue.length > 0 ? (
          <div className="rounded-md bg-status-danger p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-danger-foreground">
              <AlertTriangle className="size-3.5" />
              Overdue ({overdue.length})
            </p>
            <ul className="mt-1 space-y-0.5">
              {overdue.slice(0, 4).map((t) => (
                <li key={t.id} className="truncate text-sm text-status-danger-foreground">
                  {t.title} <span className="opacity-70">— was due {formatDate(t.deadline!)}</span>
                </li>
              ))}
              {overdue.length > 4 ? <li className="text-xs text-status-danger-foreground opacity-70">+{overdue.length - 4} more</li> : null}
            </ul>
          </div>
        ) : null}

        {dueSoon.length > 0 ? (
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              <Clock3 className="size-3.5" />
              Due soon
            </p>
            <ul className="mt-1 space-y-0.5">
              {dueSoon.slice(0, 4).map((t) => (
                <li key={t.id} className="truncate text-sm">
                  {t.title} <span className="text-muted-foreground">— due {formatDate(t.deadline!)}</span>
                </li>
              ))}
              {dueSoon.length > 4 ? <li className="text-xs text-muted-foreground">+{dueSoon.length - 4} more</li> : null}
            </ul>
          </div>
        ) : null}

        {recentActivity.length > 0 ? (
          <div className="sm:col-span-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              <History className="size-3.5" />
              Recent activity
            </p>
            <ul className="mt-1 space-y-1">
              {recentActivity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{a.description}</span>
                  <span className="shrink-0 text-muted-foreground/70">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
