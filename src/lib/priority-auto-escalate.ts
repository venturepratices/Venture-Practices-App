// Pure decision logic for automatic priority escalation, shared by the cron
// route (src/app/api/cron/priority-auto-escalate/route.ts) and its tests —
// kept separate from the route so the rule is easy to reason about on its
// own. See PriorityLevelOption.autoApplyDaysBeforeDue in prisma/schema.prisma
// for the field this reads.

export type EscalationLevel = {
  id: string;
  sequenceNumber: number;
  autoApplyDaysBeforeDue: number | null;
};

/**
 * The most urgent priority level whose auto-apply window has been entered
 * (daysUntilDue <= its threshold), or null if none has. Among every level
 * with a threshold that applies, "most urgent" is the one with the highest
 * sequenceNumber — the same ordering Settings → Priority Levels displays.
 */
export function computeTargetPriorityLevel(
  levels: EscalationLevel[],
  daysUntilDue: number
): EscalationLevel | null {
  let target: EscalationLevel | null = null;
  for (const level of levels) {
    if (level.autoApplyDaysBeforeDue == null) continue;
    if (daysUntilDue > level.autoApplyDaysBeforeDue) continue;
    if (!target || level.sequenceNumber > target.sequenceNumber) target = level;
  }
  return target;
}

/**
 * Escalation only ever raises priority, never lowers it — a person can
 * always manually set a task back down, and the next cron run will only
 * re-raise it if the task is still within an auto-apply window (confirmed
 * with the user: automation "should still fire" even after a manual
 * downgrade, but never fires downward on its own).
 */
export function shouldEscalate(
  target: EscalationLevel | null,
  currentSequenceNumber: number | null
): target is EscalationLevel {
  if (!target) return false;
  return currentSequenceNumber == null || target.sequenceNumber > currentSequenceNumber;
}
