import { cache } from "react";

import { prisma } from "@/lib/prisma";

/**
 * Live, admin-configurable replacement for the old fixed TaskStatus enum —
 * see TaskStatusOption in prisma/schema.prisma. This is the single source of
 * truth every consumer (Board columns, filters, dashboard rollups, the
 * detail panel's status select, etc.) should read from, instead of the
 * static TASK_STATUS_VALUES/LABELS/TONES constants that used to live in
 * src/lib/validations/task.ts and src/components/tasks/status-pill.tsx.
 *
 * cache()-deduped per request so multiple components on the same page each
 * calling this only costs one query, same pattern as
 * src/lib/permissions.ts's loadPermissions().
 */
export const getTaskStatusOptions = cache(async function getTaskStatusOptions() {
  return prisma.taskStatusOption.findMany({ orderBy: { sequenceNumber: "asc" } });
});

export const getCompleteStatusId = cache(async function getCompleteStatusId(): Promise<string> {
  const complete = await prisma.taskStatusOption.findFirst({ where: { isComplete: true }, select: { id: true } });
  if (!complete) throw new Error("No TaskStatusOption has isComplete: true — data integrity issue.");
  return complete.id;
});

export async function isCompleteStatusId(statusId: string): Promise<boolean> {
  return statusId === (await getCompleteStatusId());
}
