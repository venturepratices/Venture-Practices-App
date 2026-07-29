import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import type { StagesSnapshot } from "@/lib/workflow-instance";

function labelFor(instance: { name: string; client: { name: string } | null }): string {
  return instance.client ? `${instance.name} — ${instance.client.name}` : instance.name;
}

/**
 * Notifies every assignee of every task in the given stage that it's their
 * turn — WORKFLOW_STAGE_STARTED, skipping actorId. Used both right after a
 * workflow instance is created (for stage 1, which has no predecessor stage
 * to trigger it) and from maybeAdvanceWorkflowStage below (for every stage
 * after the first).
 */
export async function notifyWorkflowStageTasks(instanceId: string, stageNumber: number, actorId: string | null) {
  const instance = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    select: { name: true, stagesSnapshot: true, clientId: true, client: { select: { name: true } } },
  });
  if (!instance) return;

  // Excludes tasks already COMPLETE — someone who finished their stage-N+1
  // work early (before stage N wrapped) already knows they're done; sending
  // "it's your turn" for something they've already handled would just be
  // noise, not the assembly-line signal this notification exists to give.
  const tasks = await prisma.task.findMany({
    where: { workflowInstanceId: instanceId, workflowStageNumber: stageNumber, status: { not: "COMPLETE" } },
    select: {
      id: true,
      title: true,
      assignees: { select: { teamMemberId: true, teamMember: { select: { name: true } } } },
    },
  });
  if (tasks.length === 0) return;

  const snapshot = instance.stagesSnapshot as StagesSnapshot;
  const stageLabel = snapshot.find((s) => s.sequenceNumber === stageNumber)?.name ?? `Stage ${stageNumber}`;
  const instanceLabel = labelFor(instance);

  for (const task of tasks) {
    const linkPath = instance.clientId
      ? `/clients/${instance.clientId}/workflows/${instanceId}?taskId=${task.id}`
      : `/workflows/${instanceId}?taskId=${task.id}`;
    for (const a of task.assignees) {
      if (a.teamMemberId === actorId) continue;
      await notify({
        recipientId: a.teamMemberId,
        type: "WORKFLOW_STAGE_STARTED",
        entityType: "Task",
        entityId: task.id,
        entityLabel: task.title,
        message: `${a.teamMember.name} — "${task.title}" is now up in ${instanceLabel} (${stageLabel})`,
        linkPath,
      });
    }
  }
}

/**
 * Called after a task flips to COMPLETE. If that task belonged to a
 * WorkflowInstance and just finished off every task in the instance's
 * current stage, advances to the next stage (or, if that was the last
 * stage, marks the instance COMPLETE) and notifies the right people:
 *   - the last stage completing -> WORKFLOW_COMPLETED to the creator and
 *     every assignee across the whole instance, deduped.
 *   - any other stage completing -> WORKFLOW_STAGE_STARTED to every
 *     assignee of the new stage's tasks, via notifyWorkflowStageTasks.
 *
 * The transition itself is a conditional update guarded on the currently-
 * stored stage number, so completing the same task twice (or two tasks in
 * the same stage racing to close it out) can never double-advance — direct
 * mirror of maybeAdvanceCampaignStage's race-safety pattern.
 */
export async function maybeAdvanceWorkflowStage(
  instanceId: string,
  actorId: string | null
): Promise<{ completed: true } | { newStageNumber: number } | null> {
  const instance = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    include: {
      client: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      tasks: {
        select: {
          id: true,
          status: true,
          workflowStageNumber: true,
          assignees: { select: { teamMemberId: true, teamMember: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  if (!instance || instance.status !== "ACTIVE") return null;

  const currentStageNumber = instance.currentStageNumber;
  const stageTasks = instance.tasks.filter((t) => t.workflowStageNumber === currentStageNumber);
  if (stageTasks.length === 0 || !stageTasks.every((t) => t.status === "COMPLETE")) return null;

  const snapshot = instance.stagesSnapshot as StagesSnapshot;
  const maxStage = Math.max(...snapshot.map((s) => s.sequenceNumber));
  const nextStageNumber = currentStageNumber + 1;
  const isFinalStage = nextStageNumber > maxStage;

  const advanced = await prisma.workflowInstance.updateMany({
    where: { id: instanceId, currentStageNumber },
    data: isFinalStage ? { status: "COMPLETE", completedAt: new Date() } : { currentStageNumber: nextStageNumber },
  });
  if (advanced.count === 0) return null; // already advanced by a concurrent request

  const instanceLabel = labelFor(instance);

  if (isFinalStage) {
    const recipients = new Map<string, string>();
    for (const task of instance.tasks) {
      for (const a of task.assignees) recipients.set(a.teamMemberId, a.teamMember.name);
    }
    if (instance.createdBy) recipients.set(instance.createdBy.id, instance.createdBy.name);

    const completedLinkPath = instance.client
      ? `/clients/${instance.client.id}/workflows/${instance.id}`
      : `/workflows/${instance.id}`;
    for (const [teamMemberId, name] of recipients) {
      if (teamMemberId === actorId) continue;
      await notify({
        recipientId: teamMemberId,
        type: "WORKFLOW_COMPLETED",
        entityType: "WorkflowInstance",
        entityId: instance.id,
        entityLabel: instanceLabel,
        message: `${name} — ${instanceLabel} is complete`,
        linkPath: completedLinkPath,
      });
    }

    await logActivity({
      actorId: null,
      actorName: null,
      entityType: "WorkflowInstance",
      entityId: instance.id,
      entityLabel: instanceLabel,
      action: "workflow_completed",
      description: `${instanceLabel} completed all stages`,
    });

    return { completed: true };
  }

  await notifyWorkflowStageTasks(instance.id, nextStageNumber, actorId);

  const newStageLabel = snapshot.find((s) => s.sequenceNumber === nextStageNumber)?.name ?? `Stage ${nextStageNumber}`;
  const currentStageLabel = snapshot.find((s) => s.sequenceNumber === currentStageNumber)?.name ?? `Stage ${currentStageNumber}`;
  await logActivity({
    actorId: null,
    actorName: null,
    entityType: "WorkflowInstance",
    entityId: instance.id,
    entityLabel: instanceLabel,
    action: "stage_advanced",
    description: `${instanceLabel} automatically advanced from ${currentStageLabel} to ${newStageLabel}`,
  });

  // The stage we just advanced into might ALSO already be fully complete —
  // every one of its tasks finished early, before this stage was current.
  // Recurse so a chain of early-completed stages doesn't get stuck waiting
  // on a task-completion event that will never come (nothing changes state
  // on a task that's already COMPLETE, so nothing would otherwise re-trigger
  // this check for it).
  const cascaded = await maybeAdvanceWorkflowStage(instanceId, actorId);
  return cascaded ?? { newStageNumber: nextStageNumber };
}
