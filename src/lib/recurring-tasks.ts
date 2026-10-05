import { prisma } from "@/lib/prisma";
import { addDaysToDateString, addMonthsToDateString, dateInputValue, deadlineFromDateInput } from "@/lib/utils";
import type { RecurrenceUnit, Task, TaskOccurrence } from "@/generated/prisma/client";

const RECURRING_OCCURRENCES: TaskOccurrence[] = [
  "RECURRING_WEEKLY",
  "RECURRING_MONTHLY",
  "RECURRING_BIMONTHLY",
  "RECURRING_QUARTERLY",
  "RECURRING_CUSTOM",
];

/**
 * Advances a deadline by one cadence, as CALENDAR math in the app's timezone:
 * the current deadline's date is stepped forward, then stored back as the end
 * of that day (see the deadline convention in src/lib/utils.ts).
 *
 * It deliberately does not use setDate/setMonth on the deadline itself —
 * those read the SERVER's local timezone, so the same task advanced to a
 * different day on a developer's machine than on the UTC production box.
 */
function computeNextDeadline(
  current: Date | null,
  occurrence: TaskOccurrence,
  customRecurrenceInterval: number | null,
  customRecurrenceUnit: RecurrenceUnit | null
): Date | null {
  if (!RECURRING_OCCURRENCES.includes(occurrence)) return null;
  const currentDate = dateInputValue(current ?? new Date());

  let nextDate = currentDate;
  if (occurrence === "RECURRING_WEEKLY") nextDate = addDaysToDateString(currentDate, 7);
  if (occurrence === "RECURRING_MONTHLY") nextDate = addMonthsToDateString(currentDate, 1);
  if (occurrence === "RECURRING_BIMONTHLY") nextDate = addMonthsToDateString(currentDate, 2);
  if (occurrence === "RECURRING_QUARTERLY") nextDate = addMonthsToDateString(currentDate, 3);
  if (occurrence === "RECURRING_CUSTOM") {
    const interval = customRecurrenceInterval ?? 1;
    const unit = customRecurrenceUnit ?? "WEEK";
    if (unit === "DAY") nextDate = addDaysToDateString(currentDate, interval);
    if (unit === "WEEK") nextDate = addDaysToDateString(currentDate, interval * 7);
    if (unit === "MONTH") nextDate = addMonthsToDateString(currentDate, interval);
  }
  return deadlineFromDateInput(nextDate);
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
