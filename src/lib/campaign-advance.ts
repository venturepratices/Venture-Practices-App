import { logActivity } from "@/lib/activity-log";
import { CAMPAIGN_STAGE_LABELS, campaignLabel as formatCampaignLabel, nextCampaignStage, type CampaignStageValue } from "@/lib/campaign-stage";
import { notify, notifyChannel } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { mentionOrName } from "@/lib/slack";
import { getCompleteStatusId } from "@/lib/task-status";
import { deadlineLine } from "@/lib/utils";

type AssigneeMember = { id: string; name: string; email: string; slackUserId: string | null };

/**
 * Called after a task flips to COMPLETE. If that task belonged to a campaign
 * and just finished off every task in the campaign's current stage, advances
 * the campaign to the next stage and notifies people about it:
 *   - each assignee of a task in the new stage gets a CAMPAIGN_TASK_ASSIGNED
 *     notification (their work is now actionable) — this is also what tells
 *     wizard-spawned assignees about their tasks in the first place, since
 *     the wizard creates all tasks up front without notifying anyone.
 *   - everyone else "related to the project" — any assignee on any task in
 *     the campaign — gets a broader CAMPAIGN_STAGE_ADVANCED notification,
 *     skipping anyone who already got the more specific task-assigned one
 *     above.
 *
 * The stage transition itself is a conditional update guarded on the
 * currently-stored stage, so completing the same task twice (or two tasks in
 * the same stage racing to close it out) can never double-advance.
 */
export async function maybeAdvanceCampaignStage(campaignId: string, actorId: string | null) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      client: { select: { id: true, name: true } },
      tasks: {
        select: {
          id: true,
          title: true,
          statusId: true,
          campaignStage: true,
          deadline: true,
          assignees: { select: { teamMemberId: true, teamMember: { select: { id: true, name: true, email: true, slackUserId: true } } } },
        },
      },
    },
  });
  if (!campaign) return null;

  const currentStage = campaign.currentStage as CampaignStageValue;
  const stageTasks = campaign.tasks.filter((t) => (t.campaignStage ?? "PLANNING") === currentStage);
  const completeId = await getCompleteStatusId();
  if (stageTasks.length === 0 || !stageTasks.every((t) => t.statusId === completeId)) return null;

  const newStage = nextCampaignStage(currentStage);
  if (!newStage) return null;

  const advanced = await prisma.campaign.updateMany({
    where: { id: campaignId, currentStage },
    data: { currentStage: newStage },
  });
  if (advanced.count === 0) return null; // already advanced by a concurrent request

  const campaignLabel = `${formatCampaignLabel(campaign)} — ${campaign.client.name}`;
  const newStageLabel = CAMPAIGN_STAGE_LABELS[newStage];

  const campaignLinkPath = `/clients/${campaign.client.id}/campaigns/${campaign.id}`;

  const newStageAssigneeIds = new Set<string>();
  const newStageTasks = campaign.tasks.filter((t) => (t.campaignStage ?? "PLANNING") === newStage);
  for (const task of newStageTasks) {
    for (const a of task.assignees) {
      newStageAssigneeIds.add(a.teamMemberId);
      if (a.teamMemberId === actorId) continue;
      await notify({
        recipientId: a.teamMemberId,
        type: "CAMPAIGN_TASK_ASSIGNED",
        entityType: "Task",
        entityId: task.id,
        entityLabel: task.title,
        title: `You're up: "${task.title}"`,
        lines: [`Campaign: ${campaignLabel}`, `Stage: ${newStageLabel}`, ...deadlineLine(task.deadline)],
        linkPath: campaignLinkPath,
      });
    }
  }

  const related = new Map<string, AssigneeMember>();
  for (const task of campaign.tasks) {
    for (const a of task.assignees) related.set(a.teamMemberId, a.teamMember);
  }

  for (const [teamMemberId] of related) {
    if (teamMemberId === actorId) continue;
    if (newStageAssigneeIds.has(teamMemberId)) continue; // already got the specific task notification above
    await notify({
      recipientId: teamMemberId,
      type: "CAMPAIGN_STAGE_ADVANCED",
      entityType: "Campaign",
      entityId: campaign.id,
      entityLabel: campaignLabel,
      title: `Campaign advanced: ${campaignLabel}`,
      lines: [`Now in: ${newStageLabel}`],
      linkPath: campaignLinkPath,
    });
  }

  // One team-facing summary of the stage advance in the client's channel —
  // separate from (never inside) the per-recipient loops above.
  const newStageMembers = new Map<string, AssigneeMember>();
  for (const task of newStageTasks) {
    for (const a of task.assignees) newStageMembers.set(a.teamMemberId, a.teamMember);
  }
  const newStageMentions = await Promise.all(
    [...newStageMembers.values()].map((m) => mentionOrName(m, m.name))
  );
  await notifyChannel({
    clientId: campaign.client.id,
    title: "Campaign stage advanced",
    lines: [
      `Campaign: ${campaignLabel}`,
      `"${CAMPAIGN_STAGE_LABELS[currentStage]}" ✅ complete`,
      `Now in: ${newStageLabel}`,
      ...(newStageMentions.length > 0 ? [`Up next: ${newStageMentions.join(", ")}`] : []),
    ],
    linkPath: campaignLinkPath,
  });

  await logActivity({
    actorId: null,
    actorName: null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: campaignLabel,
    clientId: campaign.client.id,
    action: "stage_advanced",
    description: `${campaignLabel} automatically advanced from ${CAMPAIGN_STAGE_LABELS[currentStage]} to ${newStageLabel}`,
  });

  return { newStage };
}

/**
 * Called after an Asset's status recomputes to APPROVED (see
 * recomputeAssetStatus in src/lib/asset-status.ts). If that asset is linked
 * as some campaign's proof asset, marks every incomplete Approval-stage task
 * on that campaign COMPLETE and runs the normal auto-advance above. actorId
 * is null for the recompute-triggered path (matches the null-actor
 * convention for system-driven ActivityLog entries elsewhere in this file);
 * a caller that already has a real actor (e.g. linking an already-APPROVED
 * asset to a campaign) may pass one instead.
 *
 * Deliberately one-directional: unlinking a proof asset later never
 * reopens these tasks or reverses the stage advance.
 */
export async function maybeCompleteApprovalTasksForProofAsset(assetId: string, actorId: string | null) {
  const campaign = await prisma.campaign.findFirst({ where: { proofAssetId: assetId }, select: { id: true } });
  if (!campaign) return;

  const completeId = await getCompleteStatusId();
  const incomplete = await prisma.task.findMany({
    where: { campaignId: campaign.id, campaignStage: "APPROVAL", statusId: { not: completeId } },
    select: { id: true, title: true, clientId: true },
  });
  if (incomplete.length === 0) return;

  await prisma.task.updateMany({
    where: { id: { in: incomplete.map((t) => t.id) } },
    data: { statusId: completeId },
  });

  for (const task of incomplete) {
    await logActivity({
      actorId,
      actorName: null,
      entityType: "Task",
      entityId: task.id,
      entityLabel: task.title,
      clientId: task.clientId,
      action: "status_changed",
      description: `"${task.title}" auto-completed — proof asset approved`,
    });
  }

  await maybeAdvanceCampaignStage(campaign.id, actorId);
}
