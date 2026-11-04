import type { SalesActivityType } from "@/generated/prisma/enums";
import { addDaysToDateString, dateInputValue, endOfDay } from "@/lib/utils";

// The automatic Sales rules, as plain functions with no database access, so the
// server code that moves deals around can call them and tests can run them directly.
// Owner-required is not here: the non-null `ownerId` column and zod enforce it.

export type RuleViolation = { code: "PROPOSAL_NEEDS_VALUE"; message: string };

export type NewActivity = {
  type: SalesActivityType;
  subject: string;
  dueAt: Date;
  hasTime: false;
  createdBy: string;
};

/** A deal can't enter a stage that requires value (Proposal Sent) until both amounts are filled in. */
export function checkStageMove(
  deal: { valueCents: number; mrrCents: number },
  target: { requiresValue: boolean },
): RuleViolation | null {
  if (target.requiresValue && (deal.valueCents <= 0 || deal.mrrCents <= 0)) {
    return {
      code: "PROPOSAL_NEEDS_VALUE",
      message: "Add the total value and monthly value before moving to Proposal Sent.",
    };
  }
  return null;
}

/** Follow-ups that get created automatically when a deal enters a stage. */
export function activitiesOnStageEntry(target: { isNoShow: boolean }, now: Date): NewActivity[] {
  if (!target.isNoShow) return [];
  return [
    {
      type: "CALL",
      subject: "Reschedule the missed demo",
      dueAt: endOfDay(dateInputValue(now)),
      hasTime: false,
      createdBy: "rule:no-show",
    },
  ];
}

/** When to check on a territory hold: 7 calendar days before it expires, end of that day in app time. */
export function territoryHoldCheckDate(expiry: Date): Date {
  return endOfDay(addDaysToDateString(dateInputValue(expiry), -7));
}

/** An open deal with nothing scheduled is stalled. Won and lost deals never are. */
export function isStalled(openActivityCount: number, status: "OPEN" | "WON" | "LOST"): boolean {
  return status === "OPEN" && openActivityCount === 0;
}
