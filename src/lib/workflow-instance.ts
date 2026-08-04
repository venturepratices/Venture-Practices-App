import type { Prisma } from "@/generated/prisma/client";

export type StageSnapshotTaskLink = { url: string; label: string };

export type StageSnapshotTask = {
  title: string;
  description: string | null;
  // A TaskStatusOption id, not a fixed enum value — see TaskStatusOption.
  defaultStatus: string;
  sequenceNumber: number;
  defaultAssigneeIds: string[];
  links: StageSnapshotTaskLink[];
};

export type StageSnapshotStage = {
  name: string;
  description: string | null;
  sequenceNumber: number;
  taskTemplates: StageSnapshotTask[];
};

export type StagesSnapshot = StageSnapshotStage[];

// Spawns one real Task per template task in the snapshot, attached to the
// given workflow instance + stage, with its default assignees copied in as
// TaskAssignee rows. Bulk-inserted (createManyAndReturn + createMany) rather
// than one Task+TaskAssignee pair per task, same reasoning as
// spawnCampaignTasks — a workflow can spawn many tasks across many stages in
// one call, and sequential round trips inside one interactive transaction
// risk blowing past Prisma's default 5s timeout.
export async function spawnWorkflowTasks(
  tx: Prisma.TransactionClient,
  params: { instanceId: string; clientId: string | null; stages: StagesSnapshot }
) {
  const flatTasks = params.stages.flatMap((stage) =>
    stage.taskTemplates.map((task) => ({ ...task, stageNumber: stage.sequenceNumber }))
  );
  if (flatTasks.length === 0) return;

  const createdTasks = await tx.task.createManyAndReturn({
    data: flatTasks.map((task) => ({
      title: task.title,
      description: task.description,
      statusId: task.defaultStatus,
      clientId: params.clientId,
      workflowInstanceId: params.instanceId,
      workflowStageNumber: task.stageNumber,
      workflowTaskOrder: task.sequenceNumber,
    })),
  });

  const assigneeRows = createdTasks.flatMap((task, index) =>
    flatTasks[index].defaultAssigneeIds.map((teamMemberId) => ({ taskId: task.id, teamMemberId }))
  );
  if (assigneeRows.length > 0) {
    await tx.taskAssignee.createMany({ data: assigneeRows });
  }

  const linkRows = createdTasks.flatMap((task, index) =>
    flatTasks[index].links.map((link) => ({ taskId: task.id, url: link.url, label: link.label }))
  );
  if (linkRows.length > 0) {
    await tx.taskLink.createMany({ data: linkRows });
  }
}
