import { DUE_CHOICES } from "@/lib/sales/constants";
import { dayLabel, isValidDateString } from "@/lib/sales/format";
import type { TimelineEntry } from "@/lib/sales/timeline";
import { addDaysToDateString, dateInputValue } from "@/lib/utils";

// Pure helpers for the slide-in deal panel (deal-panel.tsx and its parts):
// History grouped by day, the composer's due date, when to ask for a next
// step, the stage caption, the Sheet width and when the panel shows. No
// database and no React, so they are unit-tested here and safe in the
// browser. Days are app-time (Eastern) days, never UTC or the viewer's own
// zone.

/**
 * The panel's width on the shared Sheet. SheetContent sets its own width with
 * `data-[side=right]:w-3/4` and `data-[side=right]:sm:max-w-sm`; these use the
 * same `data-[side=right]:` variant so tailwind-merge drops those two. A plain
 * `w-full sm:max-w-[560px]` would survive the merge but lose to the attribute
 * selector's higher specificity, leaving the panel 75% wide on phones and
 * 384px on desktop. Full screen under 640px, 560px above (Decision 5).
 */
export const DEAL_PANEL_SHEET_CLASS = "gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]";

/**
 * Whether the deal panel shows: the URL names a deal (`?deal=`) and no close
 * is on its way. `closing` is the pending state of the transition that
 * replaced the URL on close, so the panel hides at once and the URL catches
 * up later. It ends when the router settles, whether the close landed or a
 * reopen of the same deal replaced it, so the panel never remembers a
 * dismissed deal and a deal reopened mid-close opens again.
 */
export function dealPanelOpen(dealId: string | null, closing: boolean): boolean {
  return dealId !== null && !closing;
}

/**
 * History entries in day groups for the sticky day headers: "Today",
 * "Yesterday", then short dates ("Nov 3"), each day read in app time. The
 * entries arrive newest first (timeline.ts), so the groups do too, and each
 * group keeps the order it was given.
 */
export function groupTimelineByDay(entries: TimelineEntry[], now: Date): { label: string; entries: TimelineEntry[] }[] {
  const groups: { day: string; label: string; entries: TimelineEntry[] }[] = [];
  for (const entry of entries) {
    const at = new Date(entry.at);
    const day = dateInputValue(at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, label: dayLabel(at, now), entries: [entry] });
  }
  return groups.map(({ label, entries: dayEntries }) => ({ label, entries: dayEntries }));
}

export type DueChoice = "today" | "tomorrow" | "2-days" | "next-week" | "pick";

/**
 * The "YYYY-MM-DD" an activity is due from the composer's due choice: days
 * added to `today` (app time, read with todayDateString() at the moment of the
 * click, so "Tomorrow" at 11:30 PM Eastern is the next Eastern day), or the
 * picked date. Null when "Pick a date" has no real date yet.
 */
export function composerDueDate(choice: DueChoice, today: string, picked: string): string | null {
  if (choice === "pick") return isValidDateString(picked) ? picked : null;
  const offset = DUE_CHOICES.find((option) => option.id === choice)?.offsetDays ?? 0;
  return addDaysToDateString(today, offset);
}

/** After a to-do is ticked done: an open deal with nothing else scheduled asks for its next step (spec rule 1). */
export function needsNextStepPrompt(deal: { status: string; openActivityCount: number }): boolean {
  return deal.status === "OPEN" && deal.openActivityCount === 0;
}

/** The first words of a lost deal's strip: "Lost: Price.", or "Lost." when no reason was stored (an imported deal). */
export function lostHeadline(reason: string | null): string {
  const trimmed = reason?.trim();
  return trimmed ? `Lost: ${trimmed}.` : "Lost.";
}

/**
 * Where the stage bar scrolls to when it opens on a phone, where it is wider
 * than the screen (C4): the current stage in the middle of the bar, held
 * between the bar's start and its end. `item` is the current chevron's offset
 * and width inside the bar; a bar that fits stays at 0.
 */
export function centeredScrollLeft(
  item: { start: number; width: number },
  bar: { width: number; scrollWidth: number },
): number {
  const most = Math.max(0, bar.scrollWidth - bar.width);
  return Math.min(most, Math.max(0, item.start + item.width / 2 - bar.width / 2));
}

/**
 * The line under the stage bar: "Demo Complete · 1 day in this stage · 30%
 * win chance" for an open deal. A won or lost deal says its status and where
 * it sits ("Lost · Contract Signed"): the stage's win chance and clock no
 * longer apply to it (C3; a lost deal counts 0% in forecasts, Ruling 19).
 */
export function stageCaption(
  stageName: string,
  days: number,
  probability: number,
  status: "OPEN" | "WON" | "LOST",
): string {
  if (status !== "OPEN") return `${status === "WON" ? "Won" : "Lost"} · ${stageName}`;
  return `${stageName} · ${days} ${days === 1 ? "day" : "days"} in this stage · ${probability}% win chance`;
}
