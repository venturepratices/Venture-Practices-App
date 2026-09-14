import { cache } from "react";

import { prisma } from "@/lib/prisma";

/**
 * Admin-configurable priority levels — see PriorityLevelOption in
 * prisma/schema.prisma. Same cache()-deduped-per-request pattern as
 * src/lib/task-status.ts's getTaskStatusOptions().
 */
export const getPriorityLevelOptions = cache(async function getPriorityLevelOptions() {
  return prisma.priorityLevelOption.findMany({ orderBy: { sequenceNumber: "asc" } });
});

export async function isValidPriorityLevelId(priorityLevelId: string): Promise<boolean> {
  const options = await getPriorityLevelOptions();
  return options.some((o) => o.id === priorityLevelId);
}
