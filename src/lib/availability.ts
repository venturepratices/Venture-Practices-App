import { zonedDateTime } from "@/lib/utils";

/** A time interval, always in real UTC instants. */
export type Interval = { start: Date; end: Date };

/** Sorts and merges overlapping/adjacent intervals into the minimal covering set. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [sorted[0]];
  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) last.end = current.end;
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/**
 * Gaps within [windowStart, windowEnd] not covered by any of `busy` — i.e.
 * slots where NOBODY in the considered set is busy. `busy` should already be
 * the union of every relevant person's busy blocks; a gap here means every
 * one of them is free. Gaps shorter than minMinutes are dropped (a 5-minute
 * "free slot" isn't useful for scheduling).
 */
export function computeFreeSlots(windowStart: Date, windowEnd: Date, busy: Interval[], minMinutes = 30): Interval[] {
  const merged = mergeIntervals(busy).filter((b) => b.end > windowStart && b.start < windowEnd);
  const slots: Interval[] = [];
  let cursor = windowStart;
  for (const block of merged) {
    if (block.start.getTime() - cursor.getTime() >= minMinutes * 60_000) {
      slots.push({ start: cursor, end: block.start });
    }
    if (block.end.getTime() > cursor.getTime()) cursor = block.end;
  }
  if (windowEnd.getTime() - cursor.getTime() >= minMinutes * 60_000) {
    slots.push({ start: cursor, end: windowEnd });
  }
  return slots;
}

/** The [00:00, 24:00) window of `dateString` in the given IANA timezone, as real UTC instants. */
export function dayBoundsInTz(dateString: string, timeZone: string): Interval {
  const start = zonedDateTime(dateString, "00:00", timeZone);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Where a busy block falls within a day, as CSS percentages — for drawing a horizontal timeline bar. */
export function intervalPositionInDay(interval: Interval, day: Interval): { leftPct: number; widthPct: number } {
  const dayMs = day.end.getTime() - day.start.getTime();
  const clampedStart = Math.max(interval.start.getTime(), day.start.getTime());
  const clampedEnd = Math.min(interval.end.getTime(), day.end.getTime());
  const leftPct = ((clampedStart - day.start.getTime()) / dayMs) * 100;
  const widthPct = Math.max(0, ((clampedEnd - clampedStart) / dayMs) * 100);
  return { leftPct, widthPct };
}

export function formatTimeInTz(date: Date, timeZone: string): string {
  return date.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}
