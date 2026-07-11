import { prisma } from "@/lib/prisma";
import type { Task, TaskOccurrence } from "@/generated/prisma/client";

const RECURRING_OCCURRENCES: TaskOccurrence[] = ["RECURRING_WEEKLY", "RECURRING_MONTHLY", "RECURRING_QUARTERLY"];

function computeNextDeadline(current: Date | null, occurrence: TaskOccurrence): Date | null {
  if (!RECURRING_OCCURRENCES.includes(occurrence)) return null;
  const next = new Date(current ?? new Date());
  if (occurrence === "RECURRING_WEEKLY") next.setDate(next.getDate() + 7);
  if (occurrence === "RECURRING_MONTHLY") next.setMonth(next.getMonth() + 1);
  if (occurrence === "RECURRING_QUARTERLY") next.setMonth(next.getMonth() + 3);
  return next;
}

/**
 * When a recurring task (weekly/monthly/quarterly) is completed, create its
 * next occurrence so retainer-style work doesn't need manual recreation.
 * The new deadline is computed from the completed task's own deadline (not
 * today), keeping a fixed cadence — e.g. "every Monday" stays every Monday
 * even if this instance was completed late.
 */
export async function maybeCreateNextOccurrence(task: Task) {
  if (!RECURRING_OCCURRENCES.includes(task.occurrence)) return null;

  return prisma.task.create({
    data: {
      title: task.title,
      assigneeId: task.assigneeId,
      clientId: task.clientId,
      occurrence: task.occurrence,
      status: "NEXT_UP",
      deadline: computeNextDeadline(task.deadline, task.occurrence),
    },
  });
}
