import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getClientUserSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { StatusPillBase, type StatusTone } from "@/components/ui/status-pill";
import { WorkflowPipeline } from "@/components/workflows/workflow-pipeline";
import type { StagesSnapshot } from "@/lib/workflow-instance";

const STATUS_TONE: Record<string, StatusTone> = { ACTIVE: "blue", COMPLETE: "success", CANCELLED: "slate" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", COMPLETE: "Complete", CANCELLED: "Cancelled" };

/**
 * Client-portal workflow detail. Same stage-progress info as the list page,
 * plus per-stage task counts — deliberately NO task list, NO assignee names.
 * The client sees where things stand, not our internal to-do list. Mirrors
 * /portal/campaigns/[campaignId]'s scoping and visibility rules exactly.
 */
export default async function PortalWorkflowDetailPage({ params }: { params: Promise<{ instanceId: string }> }) {
  const clientUser = await getClientUserSession();
  if (!clientUser) redirect("/login");

  const { instanceId } = await params;
  const instance = await prisma.workflowInstance.findFirst({
    where: { id: instanceId, clientId: clientUser.clientId, status: { not: "CANCELLED" } },
    include: { tasks: { select: { status: true, workflowStageNumber: true } } },
  });
  if (!instance) notFound();

  const snapshot = instance.stagesSnapshot as StagesSnapshot;
  const taskCounts = snapshot.reduce<Record<number, { total: number; complete: number }>>((acc, stage) => {
    const stageTasks = instance.tasks.filter((t) => t.workflowStageNumber === stage.sequenceNumber);
    acc[stage.sequenceNumber] = { total: stageTasks.length, complete: stageTasks.filter((t) => t.status === "COMPLETE").length };
    return acc;
  }, {});

  return (
    <div className="max-w-2xl p-6">
      <Link href="/portal/workflows" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        My workflows
      </Link>

      <div className="mt-2 flex items-center gap-2">
        <h1 className="text-lg font-semibold">{instance.name}</h1>
        <StatusPillBase tone={STATUS_TONE[instance.status]} label={STATUS_LABEL[instance.status]} />
      </div>

      <div className="mt-4 rounded-lg border p-4">
        <WorkflowPipeline
          stages={snapshot}
          currentStageNumber={instance.currentStageNumber}
          isComplete={instance.status === "COMPLETE"}
          taskCounts={taskCounts}
        />
      </div>
    </div>
  );
}
