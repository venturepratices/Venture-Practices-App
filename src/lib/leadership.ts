import { APP_TIME_ZONE, daysUntilDue, endOfDay, startOfDay } from "@/lib/utils";

// Quarter math for Rocks (EOS 90-day priorities). Client-safe — no server
// imports — so both the Rocks page and the API share one definition. All of
// it is read in the app's timezone, same as every other date in the app.

/** "2026-Q4" for the quarter `date` falls in (in the app's timezone). */
export function quarterKeyFor(date: Date = new Date()): string {
  const [year, month] = date.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE }).split("-").map(Number);
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

export function parseQuarterKey(key: string): { year: number; quarter: number } | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(key);
  return match ? { year: Number(match[1]), quarter: Number(match[2]) } : null;
}

/** First and last instant of a quarter, in the app's timezone. */
export function quarterRange(key: string): { start: Date; end: Date } {
  const parsed = parseQuarterKey(key) ?? parseQuarterKey(quarterKeyFor())!;
  const startMonth = (parsed.quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(parsed.year, endMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: startOfDay(`${parsed.year}-${pad(startMonth)}-01`),
    end: endOfDay(`${parsed.year}-${pad(endMonth)}-${pad(lastDay)}`),
  };
}

/** "Q4 2026" */
export function quarterLabel(key: string): string {
  const parsed = parseQuarterKey(key);
  return parsed ? `Q${parsed.quarter} ${parsed.year}` : key;
}

export function shiftQuarter(key: string, by: number): string {
  const parsed = parseQuarterKey(key) ?? parseQuarterKey(quarterKeyFor())!;
  const index = parsed.year * 4 + (parsed.quarter - 1) + by;
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Week number (1–13ish) within the quarter, days left, and total weeks — for the progress strip. */
export function quarterProgress(key: string, now: Date = new Date()) {
  const { start, end } = quarterRange(key);
  // A quarter is 90–92 days — EOS calls that 13 weeks, so round, don't ceil
  // (ceil would make a 14th week out of the last day or two).
  const totalWeeks = Math.round((end.getTime() - start.getTime()) / (7 * DAY_MS));
  const clamped = Math.min(Math.max(now.getTime(), start.getTime()), end.getTime());
  const week = Math.min(totalWeeks, Math.floor((clamped - start.getTime()) / (7 * DAY_MS)) + 1);
  const daysLeft = now.getTime() > end.getTime() ? 0 : daysUntilDue(end);
  return { week, totalWeeks, daysLeft, start, end };
}

/** One issue per non-empty line of a pasted brain dump, bullets/numbering stripped. */
export function splitBrainDump(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•–]|\d+[.)]|\[[ xX]?\])\s*/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(0, 300));
}

/**
 * Prisma `where` for team members who can open Issues & Rocks. Rock owners
 * are picked from this set only — an owner has to be able to open the page
 * to update their own status, and the Monday reminder links straight there.
 */
export const LEADERSHIP_MEMBER_WHERE = { OR: [{ isAdmin: true }, { canUseLeadership: true }] };

export const ROCK_STATUS_LABELS = { ON_TRACK: "On track", OFF_TRACK: "Off track", DONE: "Done" } as const;
export const ISSUE_KIND_LABELS = { PROBLEM: "Problem", SITUATION: "Just watching" } as const;
