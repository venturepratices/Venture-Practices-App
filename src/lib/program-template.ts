import type { Prisma } from "@/generated/prisma/client";
import type { CampaignStageValue } from "@/lib/campaign-stage";
import type { RoleTagValue } from "@/lib/role-tag";

export type TemplateSnapshotTask = {
  title: string;
  roleTag: RoleTagValue;
  daysBeforeMailDate: number | null;
  sequenceNumber: number;
};

export type TemplateSnapshotStage = {
  stage: CampaignStageValue;
  sequenceNumber: number;
  tasks: TemplateSnapshotTask[];
};

export type TemplateSnapshot = TemplateSnapshotStage[];

export type RoleBindings = {
  accountManagerId: string | null;
  creativeId: string | null;
  productionId: string | null;
};

// CLIENT role tag is intentionally never bound to a TeamMember — those
// template tasks stay unassigned agency-side (surfaced as client-facing
// todos in the portal, Slice 5).
export function resolveRoleTag(roleTag: RoleTagValue, bindings: RoleBindings): string | null {
  if (roleTag === "ACCOUNT_MANAGER") return bindings.accountManagerId;
  if (roleTag === "CREATIVE") return bindings.creativeId;
  if (roleTag === "PRODUCTION") return bindings.productionId;
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Spawns one real Task per template task in the snapshot, attached to the
// given campaign+stage, with its assignee resolved through the role bindings
// and its deadline computed from the campaign's mailDate.
//
// Batched as two bulk inserts (createManyAndReturn + createMany) rather than
// one Task+TaskAssignee pair per task — a wizard run easily spawns 100+ tasks
// (many campaigns x many template tasks each), and issuing that many
// sequential round trips one-by-one inside a single interactive transaction
// blew past Prisma's default 5s transaction timeout in testing.
export async function spawnCampaignTasks(
  tx: Prisma.TransactionClient,
  params: {
    campaignId: string;
    // The campaign's own client, so spawned tasks show up in that client's
    // Tasks tab like any other task — not just on the Direct Mail campaign
    // page itself.
    clientId: string;
    mailDate: Date | null;
    stagesSnapshot: TemplateSnapshot;
    bindings: RoleBindings;
  }
) {
  const flatTasks = params.stagesSnapshot.flatMap((stage) =>
    stage.tasks.map((task) => ({ ...task, stage: stage.stage }))
  );
  if (flatTasks.length === 0) return;

  const createdTasks = await tx.task.createManyAndReturn({
    data: flatTasks.map((task) => ({
      title: task.title,
      campaignId: params.campaignId,
      clientId: params.clientId,
      campaignStage: task.stage,
      deadline:
        params.mailDate && task.daysBeforeMailDate != null
          ? new Date(params.mailDate.getTime() - task.daysBeforeMailDate * DAY_MS)
          : null,
    })),
  });

  const assigneeRows = createdTasks
    .map((task, index) => ({ taskId: task.id, teamMemberId: resolveRoleTag(flatTasks[index].roleTag, params.bindings) }))
    .filter((row): row is { taskId: string; teamMemberId: string } => row.teamMemberId != null);

  if (assigneeRows.length > 0) {
    await tx.taskAssignee.createMany({ data: assigneeRows });
  }
}
