import type { InsightsRange } from "@/lib/sales/insights-query";
import { formatDate, startOfDay } from "@/lib/utils";

// Pure, client-safe helpers the Insights page and its charts share (Decision 27,
// Mockup v2 `viewInsights`): the range filter's labels, the words a caption
// reads a range as, the month strings every chart and table uses, the widths of
// horizontal bars, the weighted cycle-time average and its sentence, the
// compact-money strings a chart axis or a column label carries, and the "nice"
// axis scale shared by the column and line charts. No prisma, no server
// imports: every runtime value here is safe for a client component.

// The one theme token the chart series is painted with on both surfaces. The
// app's existing --primary is the Sales brand blue (#2d94c0 light, #4bafd6
// dark); its contrast against the --card fill is 3.4:1 in light and 6.5:1 in
// dark, over the 3:1 non-text floor the dataviz skill asks for. Components use
// it through Tailwind's `fill-primary` and `bg-primary`, never a raw hex.
export const CHART_SERIES_TOKEN = "primary";

/** The three ranges the filter offers, in the order they read (Decision 27). */
export const INSIGHTS_RANGES: readonly { value: InsightsRange; label: string }[] = [
  { value: 3, label: "Last 3 months" },
  { value: 6, label: "Last 6 months" },
  { value: 12, label: "Last 12 months" },
];

/** "the last 6 months" — one phrase a caption and every empty state read the range as. */
export function rangeWords(range: InsightsRange): string {
  return `the last ${range} months`;
}

/** "Nov" for "2026-11". The month is read through startOfDay, so it is the app-time month. */
export function monthLabel(month: string): string {
  return formatDate(startOfDay(`${month}-01`), { month: "short" });
}

/** "Nov 2026 (so far)" for the current month, "Dec 2025" for a past one. */
export function monthLong(month: string, current: boolean): string {
  const base = formatDate(startOfDay(`${month}-01`), { month: "short", year: "numeric" });
  return current ? `${base} (so far)` : base;
}

/**
 * The widths (as percents of the bar's track) for a row of counts: the biggest
 * fills the bar, every other grows in proportion, and when nothing happened
 * every row is 0. An empty list gives an empty list back.
 */
export function barPercents(values: number[]): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  if (max <= 0) return values.map(() => 0);
  return values.map((value) => (value / max) * 100);
}

/**
 * The weighted average cycle time across the months in the range: each month's
 * average contributes once per deal won in it, so a month with more wins pulls
 * the average more. Rounded to a whole day. Null when nothing was won.
 */
export function averageCycleDays(rows: { avgDays: number | null; count: number }[]): number | null {
  let days = 0;
  let count = 0;
  for (const row of rows) {
    if (row.avgDays === null || row.count === 0) continue;
    days += row.avgDays * row.count;
    count += row.count;
  }
  return count > 0 ? Math.round(days / count) : null;
}

/** "No wins", "1 day", "12 days": the word form the cycle headline reads as. */
export function cycleLabel(days: number | null): string {
  if (days === null) return "No wins";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * A compact dollar label for a chart axis or a column's value ("$1.5K",
 * "$120K", "$1.2M"). Keeps one decimal for in-between values, drops it on whole
 * or over-a-hundred ones, so the axis stays narrow.
 */
export function compactMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars < 1000) return `$${Math.round(dollars)}`;
  const thousands = dollars / 1000;
  if (thousands < 1000) {
    const whole = thousands >= 100 || thousands === Math.round(thousands);
    return `$${whole ? Math.round(thousands) : thousands.toFixed(1)}K`;
  }
  const millions = dollars / 1_000_000;
  const whole = millions >= 100 || millions === Math.round(millions);
  return `$${whole ? Math.round(millions) : millions.toFixed(1)}M`;
}

/**
 * The step and top of a "nice" chart axis: a round step that divides the top,
 * and a top at least as high as the value asked for. The step starts as the
 * value over the ticks asked for (so three ticks give three readable grid
 * lines) and is snapped to the nearest 1, 2, 2.5, 5 or 10 times a power of ten.
 * Shared by the column chart's grid and the line chart's.
 */
export function niceScale(max: number, ticks: number): { step: number; top: number } {
  const raw = max / ticks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / magnitude;
  const snapped = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  const step = snapped * magnitude;
  return { step, top: Math.ceil(max / step) * step };
}
