import { prisma } from "@/lib/prisma";
import type { RecurrenceUnit, Task, TaskOccurrence } from "@/generated/prisma/client";

const RECURRING_OCCURRENCES: TaskOccurrence[] = [
  "RECURRING_WEEKLY",
  "RECURRING_MONTHLY",
  "RECURRING_BIMONTHLY",
  "RECURRING_QUARTERLY",
  "RECURRING_CUSTOM",
];

function computeNextDeadline(
  current: Date | null,
  occurrence: TaskOccurrence,
  customRecurrenceInterval: number | null,
  customRecurrenceUnit: RecurrenceUnit | null
): Date | null {
  if (!RECURRING_OCCURRENCES.includes(occurrence)) return null;
  const next = new Date(current ?? new Date());
  if (occurrence === "RECURRING_WEEKLY") next.setDate(next.getDate() + 7);
  if (occurrence === "RECURRING_MONTHLY") next.setMonth(next.getMonth() + 1);
  if (occurrence === "RECURRING_BIMONTHLY") next.setMonth(next.getMonth() + 2);
  if (occurrence === "RECURRING_QUARTERLY") next.setMonth(next.getMonth() + 3);
  if (occurrence === "RECURRING_CUSTOM") {
    const interval = customRecurrenceInterval ?? 1;
    const unit = customRecurrenceUnit ?? "WEEK";
    if (unit === "DAY") next.setDate(next.getDate() + interval);
    if (unit === "WEEK") next.setDate(next.getDate() + interval * 7);
    if (unit === "MONTH") next.setMonth(next.getMonth() + interval);
  }
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

  const currentAssignees = await prisma.taskAssignee.findMany({ where: { taskId: task.id } });

  return prisma.task.create({
    data: {
      title: task.title,
      description: task.description,
      clientId: task.clientId,
      occurrence: task.occurrence,
      customRecurrenceInterval: task.customRecurrenceInterval,
      customRecurrenceUnit: task.customRecurrenceUnit,
      statusId: "NEXT_UP",
      deadline: computeNextDeadline(task.deadline, task.occurrence, task.customRecurrenceInterval, task.customRecurrenceUnit),
      assignees: { create: currentAssignees.map((a) => ({ teamMemberId: a.teamMemberId })) },
    },
    include: { assignees: { include: { teamMember: { select: { id: true, name: true } } } } },
  });
}
