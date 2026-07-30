import { logActivity } from "@/lib/activity-log";
import { notify, notifyChannel } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { mentionOrName } from "@/lib/slack";
import { TASK_STATUS_LABELS } from "@/components/tasks/status-pill";
import type { StagesSnapshot } from "@/lib/workflow-instance";

function labelFor(instance: { name: string; client: { name: string } | null }): string {
  return instance.client ? `${instance.name} — ${instance.client.name}` : instance.name;
}

type AssigneeFields = { teamMember: { id: string; name: string; email: string; slackUserId: string | null } };

type TaskLineFields = {
  title: string;
  status: string;
  deadline: Date | null;
  assignees: AssigneeFields[];
};

/**
 * Standard "For / Task / Assigned / Status / Deadline / Workflow" bullet set
 * shared by every task-level workflow notification, so a recipient can act on
 * a Slack ping without opening the app. `whatLine` is the one thing that
 * varies by notification type (why this task is being surfaced right now).
 * Names are resolved to real Slack @mentions where possible, so both the
 * recipient and the "Assigned to" list actually ping on Slack/mobile instead
 * of rendering as inert text.
 */
async function taskNotificationLines(params: {
  recipient: AssigneeFields["teamMember"];
  whatLine: string;
  task: TaskLineFields;
  instanceLabel: string;
  stageLabel: string;
}): Promise<string[]> {
  const recipientMention = await mentionOrName(params.recipient, params.recipient.name);
  const assigneeMentions = await Promise.all(
    params.task.assignees.map((a) => mentionOrName(a.teamMember, a.teamMember.name))
  );
  const lines = [
    `For: ${recipientMention}`,
    `What: ${params.whatLine}`,
    `Task: ${params.task.title}`,
    `Assigned to: ${assigneeMentions.join(", ") || "Unassigned"}`,
    `Status: ${TASK_STATUS_LABELS[params.task.status] ?? params.task.status}`,
  ];
  if (params.task.deadline) lines.push(`Deadline: ${params.task.deadline.toLocaleDateString()}`);
  lines.push(`Project: ${params.instanceLabel} — ${params.stageLabel}`);
  return lines;
}

/**
 * Notifies every assignee of every task in the given stage that it's their
 * turn — WORKFLOW_STAGE_STARTED, skipping actorId. Used both right after a
 * workflow instance is created (for stage 1, which has no predecessor stage
 * to trigger it) and from maybeAdvanceWorkflowStage below (for every stage
 * after the first).
 */
export async function notifyWorkflowStageTasks(
  instanceId: string,
  stageNumber: number,
  actorId: string | null,
  previousStageLabel?: string
) {
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
      status: true,
      deadline: true,
      assignees: { select: { teamMemberId: true, teamMember: { select: { id: true, name: true, email: true, slackUserId: true } } } },
    },
  });
  if (tasks.length === 0) return;

  const snapshot = instance.stagesSnapshot as StagesSnapshot;
  const stageLabel = snapshot.find((s) => s.sequenceNumber === stageNumber)?.name ?? `Stage ${stageNumber}`;
  const instanceLabel = labelFor(instance);
  const stageLinkPath = instance.clientId
    ? `/clients/${instance.clientId}/workflows/${instanceId}`
    : `/workflows/${instanceId}`;
  const notifiedMembers = new Map<string, AssigneeFields["teamMember"]>();

  for (const task of tasks) {
    const linkPath = instance.clientId
      ? `/clients/${instance.clientId}/workflows/${instanceId}?taskId=${task.id}`
      : `/workflows/${instanceId}?taskId=${task.id}`;
    for (const a of task.assignees) {
      if (a.teamMemberId === actorId) continue;
      notifiedMembers.set(a.teamMemberId, a.teamMember);
      const whatLine = previousStageLabel
        ? `The "${previousStageLabel}" stage just finished — this task is next`
        : "This project just started — this task is up first";
      const message = previousStageLabel
        ? `${a.teamMember.name} — the "${previousStageLabel}" stage just finished. Your task "${task.title}" is next in ${instanceLabel} (${stageLabel} stage)`
        : `${a.teamMember.name} — "${task.title}" is now up in ${instanceLabel} (${stageLabel})`;
      await notify({
        recipientId: a.teamMemberId,
        type: "WORKFLOW_STAGE_STARTED",
        entityType: "Task",
        entityId: task.id,
        entityLabel: task.title,
        message,
        linkPath,
        slackTitle: previousStageLabel ? "Your turn — new stage started" : "New project started — you're up",
        slackLines: await taskNotificationLines({
          recipient: a.teamMember,
          whatLine,
          task,
          instanceLabel,
          stageLabel,
        }),
      });
    }
  }

  if (notifiedMembers.size > 0) {
    const assignedMentions = await Promise.all(
      [...notifiedMembers.values()].map((m) => mentionOrName(m, m.name))
    );
    await notifyChannel({
      clientId: instance.clientId,
      message: `${instanceLabel}: "${stageLabel}" stage is now up`,
      linkPath: stageLinkPath,
      slackTitle: previousStageLabel ? "New stage started" : "New project started",
      slackLines: [
        `Project: ${instanceLabel}`,
        ...(previousStageLabel ? [`Previous stage: "${previousStageLabel}" ✅ complete`] : []),
        `Now on: ${stageLabel}`,
        `Assigned: ${assignedMentions.join(", ")}`,
      ],
    });
  }
}

/**
 * FYI-only intra-stage ping: when a task inside an active stage completes and
 * another still-incomplete task in that SAME stage has a defined
 * `workflowTaskOrder` immediately after it, notify that next task's
 * assignees that they're likely up next. Purely a heads-up — tasks stay
 * completable in any order, nothing is gated on this. No-ops when the
 * completed task has no order set (ad-hoc tasks added before this field
 * existed) or when it was the last ordered task in the stage (the full
 * stage-complete handoff in maybeAdvanceWorkflowStage covers that case).
 */
export async function notifyNextTaskInStage(
  instanceId: string,
  stageNumber: number,
  completedTask: { id: string; title: string; workflowTaskOrder: number | null },
  actorId: string | null,
  actorName: string
) {
  if (completedTask.workflowTaskOrder == null) return;

  const instance = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    select: { name: true, stagesSnapshot: true, clientId: true, client: { select: { name: true } } },
  });
  if (!instance) return;

  const candidates = await prisma.task.findMany({
    where: {
      workflowInstanceId: instanceId,
      workflowStageNumber: stageNumber,
      status: { not: "COMPLETE" },
      workflowTaskOrder: { gt: completedTask.workflowTaskOrder },
    },
    orderBy: { workflowTaskOrder: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      deadline: true,
      workflowTaskOrder: true,
      assignees: { select: { teamMemberId: true, teamMember: { select: { id: true, name: true, email: true, slackUserId: true } } } },
    },
  });
  if (candidates.length === 0) return;

  const nextOrder = candidates[0].workflowTaskOrder;
  const nextTasks = candidates.filter((t) => t.workflowTaskOrder === nextOrder);

  const snapshot = instance.stagesSnapshot as StagesSnapshot;
  const stageLabel = snapshot.find((s) => s.sequenceNumber === stageNumber)?.name ?? `Stage ${stageNumber}`;
  const instanceLabel = labelFor(instance);

  for (const task of nextTasks) {
    const linkPath = instance.clientId
      ? `/clients/${instance.clientId}/workflows/${instanceId}?taskId=${task.id}`
      : `/workflows/${instanceId}?taskId=${task.id}`;
    for (const a of task.assignees) {
      if (a.teamMemberId === actorId) continue;
      await notify({
        recipientId: a.teamMemberId,
        type: "WORKFLOW_TASK_UP_NEXT",
        entityType: "Task",
        entityId: task.id,
        entityLabel: task.title,
        message: `${a.teamMember.name} — you're up next on "${task.title}" in ${instanceLabel} (${stageLabel})`,
        linkPath,
        slackTitle: "You're up next",
        slackLines: await taskNotificationLines({
          recipient: a.teamMember,
          whatLine: `"${completedTask.title}" was just completed by ${actorName} — this task is next in line`,
          task,
          instanceLabel,
          stageLabel,
        }),
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
      createdBy: { select: { id: true, name: true, email: true, slackUserId: true } },
      tasks: {
        select: {
          id: true,
          status: true,
          workflowStageNumber: true,
          assignees: { select: { teamMemberId: true, teamMember: { select: { id: true, name: true, email: true, slackUserId: true } } } },
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
    const recipients = new Map<string, AssigneeFields["teamMember"]>();
    for (const task of instance.tasks) {
      for (const a of task.assignees) recipients.set(a.teamMemberId, a.teamMember);
    }
    if (instance.createdBy) recipients.set(instance.createdBy.id, instance.createdBy);

    const taskCount = instance.tasks.length;
    const summary = `all ${taskCount} task${taskCount === 1 ? "" : "s"} done`;

    const completedLinkPath = instance.client
      ? `/clients/${instance.client.id}/workflows/${instance.id}`
      : `/workflows/${instance.id}`;
    for (const [teamMemberId, member] of recipients) {
      if (teamMemberId === actorId) continue;
      const recipientMention = await mentionOrName(member, member.name);
      await notify({
        recipientId: teamMemberId,
        type: "WORKFLOW_COMPLETED",
        entityType: "WorkflowInstance",
        entityId: instance.id,
        entityLabel: instanceLabel,
        message: `${member.name} — ${instanceLabel} is complete (${summary})`,
        linkPath: completedLinkPath,
        slackTitle: "Project complete 🎉",
        slackLines: [`For: ${recipientMention}`, `What: Every stage of this project is done`, `Project: ${instanceLabel}`, `Tasks: ${taskCount} done`],
      });
    }

    await notifyChannel({
      clientId: instance.client?.id ?? null,
      message: `${instanceLabel} is complete (${summary})`,
      linkPath: completedLinkPath,
      slackTitle: "Project complete 🎉",
      slackLines: [`Project: ${instanceLabel}`, `Tasks: ${taskCount} done`],
    });

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

  const currentStageLabel = snapshot.find((s) => s.sequenceNumber === currentStageNumber)?.name ?? `Stage ${currentStageNumber}`;
  await notifyWorkflowStageTasks(instance.id, nextStageNumber, actorId, currentStageLabel);

  const newStageLabel = snapshot.find((s) => s.sequenceNumber === nextStageNumber)?.name ?? `Stage ${nextStageNumber}`;
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
