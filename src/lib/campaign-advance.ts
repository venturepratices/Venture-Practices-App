import { logActivity } from "@/lib/activity-log";
import { CAMPAIGN_STAGE_LABELS, nextCampaignStage, type CampaignStageValue } from "@/lib/campaign-stage";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

/**
 * Called after a task flips to COMPLETE. If that task belonged to a campaign
 * and just finished off every task in the campaign's current stage, advances
 * the campaign to the next stage and notifies people about it:
 *   - each assignee of a task in the new stage gets a CAMPAIGN_TASK_ASSIGNED
 *     notification (their work is now actionable) — this is also what tells
 *     wizard-spawned assignees about their tasks in the first place, since
 *     the wizard creates all tasks up front without notifying anyone.
 *   - everyone else "related to the project" — any assignee on any task in
 *     the campaign, plus the program's bound roles — gets a broader
 *     CAMPAIGN_STAGE_ADVANCED notification, skipping anyone who already got
 *     the more specific task-assigned one above.
 *
 * The stage transition itself is a conditional update guarded on the
 * currently-stored stage, so completing the same task twice (or two tasks in
 * the same stage racing to close it out) can never double-advance.
 */
export async function maybeAdvanceCampaignStage(campaignId: string, actorId: string | null) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      program: {
        select: {
          id: true,
          name: true,
          accountManagerId: true,
          accountManager: { select: { id: true, name: true } },
          roleBindings: { select: { teamMemberId: true, teamMember: { select: { id: true, name: true } } } },
        },
      },
      tasks: {
        select: {
          id: true,
          title: true,
          status: true,
          campaignStage: true,
          assignees: { select: { teamMemberId: true, teamMember: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  if (!campaign) return null;

  const currentStage = campaign.currentStage as CampaignStageValue;
  const stageTasks = campaign.tasks.filter((t) => (t.campaignStage ?? "PLANNING") === currentStage);
  if (stageTasks.length === 0 || !stageTasks.every((t) => t.status === "COMPLETE")) return null;

  const newStage = nextCampaignStage(currentStage);
  if (!newStage) return null;

  const advanced = await prisma.campaign.updateMany({
    where: { id: campaignId, currentStage },
    data: { currentStage: newStage },
  });
  if (advanced.count === 0) return null; // already advanced by a concurrent request

  const campaignLabel = `Campaign #${campaign.sequenceNumber} — ${campaign.program.name}`;
  const newStageLabel = CAMPAIGN_STAGE_LABELS[newStage];

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
        message: `${a.teamMember.name} — "${task.title}" is now up in ${campaignLabel} (${newStageLabel})`,
      });
    }
  }

  const related = new Map<string, string>();
  for (const task of campaign.tasks) {
    for (const a of task.assignees) related.set(a.teamMemberId, a.teamMember.name);
  }
  if (campaign.program.accountManagerId && campaign.program.accountManager) {
    related.set(campaign.program.accountManagerId, campaign.program.accountManager.name);
  }
  for (const rb of campaign.program.roleBindings) {
    if (rb.teamMemberId && rb.teamMember) related.set(rb.teamMemberId, rb.teamMember.name);
  }

  for (const [teamMemberId, name] of related) {
    if (teamMemberId === actorId) continue;
    if (newStageAssigneeIds.has(teamMemberId)) continue; // already got the specific task notification above
    await notify({
      recipientId: teamMemberId,
      type: "CAMPAIGN_STAGE_ADVANCED",
      entityType: "Campaign",
      entityId: campaign.id,
      entityLabel: campaignLabel,
      message: `${name} — ${campaignLabel} advanced to ${newStageLabel}`,
    });
  }

  await logActivity({
    actorId: null,
    actorName: null,
    entityType: "Campaign",
    entityId: campaign.id,
    entityLabel: campaignLabel,
    action: "stage_advanced",
    description: `${campaignLabel} automatically advanced from ${CAMPAIGN_STAGE_LABELS[currentStage]} to ${newStageLabel}`,
  });

  return { newStage };
}
