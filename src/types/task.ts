import type { Prisma } from "@/generated/prisma/client";

// Shared include shape for a task's assignees, used across every task query.
export const TASK_ASSIGNEES_INCLUDE = {
  assignees: { include: { teamMember: { select: { id: true, name: true } } } },
} as const;

export type TaskWithRelations = Prisma.TaskGetPayload<{
  include: {
    assignees: { include: { teamMember: { select: { id: true; name: true } } } };
    client: { select: { id: true; name: true } };
    createdBy: { select: { id: true; name: true } };
    workflowInstance: { select: { id: true; name: true } };
  };
}>;

// Richer shape used only by the task detail panel, which is the one place
// that needs comments and links alongside the base relations.
export type TaskDetail = Prisma.TaskGetPayload<{
  include: {
    assignees: { include: { teamMember: { select: { id: true; name: true } } } };
    client: { select: { id: true; name: true } };
    createdBy: { select: { id: true; name: true } };
    comments: { include: { author: { select: { id: true; name: true } } } };
    links: true;
    campaign: { select: { id: true; sequenceNumber: true; currentStage: true } };
  };
}>;

export type ArchivedCommentSnapshot = { authorName: string; body: string; createdAt: string };
export type ArchivedLinkSnapshot = { label: string; url: string; createdAt: string };
export type ArchivedAssigneeSnapshot = { id: string; name: string };

export type ArchivedTaskDetail = Prisma.ArchivedTaskGetPayload<{
  include: { deletedBy: { select: { name: true } } };
}>;

// Prefers the full multi-assignee snapshot (assignees Json), falling back to
// the legacy single-assignee assigneeName for rows archived before Slice 2.
export function archivedAssigneeNames(task: { assignees: unknown; assigneeName: string | null }): string {
  const snapshot = task.assignees as ArchivedAssigneeSnapshot[] | null;
  if (snapshot && snapshot.length > 0) return snapshot.map((a) => a.name).join(", ");
  return task.assigneeName ?? "Unassigned";
}
