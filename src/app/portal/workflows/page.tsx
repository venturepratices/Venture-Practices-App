import { redirect } from "next/navigation";
import Link from "next/link";

import { getClientUserSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";
import { WorkflowPipeline } from "@/components/workflows/workflow-pipeline";
import type { StagesSnapshot } from "@/lib/workflow-instance";

const STATUS_TONE: Record<string, StatusTone> = { ACTIVE: "blue", COMPLETE: "success", CANCELLED: "slate" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", COMPLETE: "Complete", CANCELLED: "Cancelled" };

/**
 * Client-portal workflow list — same shape as /portal/campaigns: stage
 * progress via the presentational WorkflowPipeline component, no task
 * titles, no assignee names. Cancelled workflows are excluded — from the
 * client's point of view an internal cancellation isn't something they need
 * visibility into.
 */
export default async function PortalWorkflowsPage() {
  const clientUser = await getClientUserSession();
  if (!clientUser) redirect("/login");

  const instances = await prisma.workflowInstance.findMany({
    where: { clientId: clientUser.clientId, status: { not: "CANCELLED" } },
    include: { tasks: { select: { status: true, workflowStageNumber: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">My workflows</h1>
      <p className="mt-1 text-sm text-muted-foreground">Where each in-progress process stands.</p>

      {instances.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">Nothing here yet — check back soon.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {instances.map((instance) => {
            const snapshot = instance.stagesSnapshot as StagesSnapshot;
            const taskCounts = snapshot.reduce<Record<number, { total: number; complete: number }>>((acc, stage) => {
              const stageTasks = instance.tasks.filter((t) => t.workflowStageNumber === stage.sequenceNumber);
              acc[stage.sequenceNumber] = { total: stageTasks.length, complete: stageTasks.filter((t) => t.status === "COMPLETE").length };
              return acc;
            }, {});

            return (
              <Link
                key={instance.id}
                href={`/portal/workflows/${instance.id}`}
                className="block rounded-lg border p-4 transition-colors hover:border-primary"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{instance.name}</p>
                  <StatusPillBase tone={STATUS_TONE[instance.status]} label={STATUS_LABEL[instance.status]} />
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
          })}
        </div>
      )}
    </div>
  );
}
