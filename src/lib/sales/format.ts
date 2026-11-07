import { MAX_DEAL_CENTS } from "@/lib/sales/constants";
import { addDaysToDateString, APP_TIME_ZONE, dateInputValue, endOfDay, formatDate, zonedDateTime } from "@/lib/utils";

// Money, names and dates as the Sales screens show them. Pure functions with no
// database access, safe for client components. Every day comparison reads
// dates in the app timezone (Eastern) through the helpers in src/lib/utils.ts,
// never in UTC or the viewer's own zone, and never through `new Date("YYYY-MM-DD")`.

// --- Money (integer cents) ---

// Whole dollars, or thousands groups of exactly three digits, then up to two decimals.
const PLAIN_MONEY = /^\d+(\.\d{1,2})?$/;
const GROUPED_MONEY = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;

/**
 * Reads what a person typed into a money box ("$14,400", "14,400.5", "1200.50")
 * as integer cents. Blank is 0. Anything else (negative, 3+ decimals, exponent
 * notation, commas that are not thousands separators, above $10,000,000) is
 * null, so the caller can refuse it instead of guessing. Done with string math,
 * not floats, so "0.29" is exactly 29 cents.
 */
export function parseMoneyToCents(input: string): number | null {
  let text = input.trim();
  if (text.startsWith("$")) text = text.slice(1).trim();
  if (text === "") return 0;
  if (text.includes(",")) {
    if (!GROUPED_MONEY.test(text)) return null;
    text = text.replace(/,/g, "");
  } else if (!PLAIN_MONEY.test(text)) {
    return null;
  }
  const [dollars, decimals = ""] = text.split(".");
  const cents = Number(dollars) * 100 + Number(decimals.padEnd(2, "0"));
  return cents > MAX_DEAL_CENTS ? null : cents;
}

/** "$14,400" for whole dollars, "$14,400.50" otherwise. */
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// --- Names ---

/** "Dana Example" -> "Dana E." (first name and last initial). A single word, or a last name that is already an initial, stays as is. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

/**
 * Ends a sentence with a period unless it already ends in ".", "!" or "?", so
 * a sentence that ends in a short name ("...go to Robert O.") never gets a
 * second one. Empty text stays empty.
 */
export function endSentence(text: string): string {
  if (text === "" || /[.!?]$/.test(text)) return text;
  return `${text}.`;
}

/** "Ben S.", "Ben S. and Robert O.", "Ben S., Dana Q. and Robert O."; nobody is empty text. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Which of four avatar colours a person gets: stable for the same id, spread across ids. */
export function avatarTone(id: string): 0 | 1 | 2 | 3 {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return (hash % 4) as 0 | 1 | 2 | 3;
}

// --- Dates (app timezone) ---

/** Whole calendar days from one "YYYY-MM-DD" to another. Negative when `to` is earlier. */
function calendarDaysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export type NextStepTone = "overdue" | "today" | "future" | "none";

/**
 * The next-step pill on a card. Colours are day-level: an activity due earlier
 * today is still "Today" all day, and turns overdue only once its day has ended
 * for the team (spec 7.4). No next step is its own state. When a time was
 * chosen (`hasTime`), the label also says it ("Tomorrow, 2:00 PM"); an overdue
 * one counts days instead.
 */
export function nextStepPill(dueAt: Date | null, now: Date, hasTime = false): { tone: NextStepTone; label: string } {
  if (!dueAt) return { tone: "none", label: "No next step" };
  const today = dateInputValue(now);
  const dueDay = dateInputValue(dueAt);
  const daysLate = calendarDaysBetween(dueDay, today);
  if (daysLate > 0) return { tone: "overdue", label: `Overdue ${daysLate}d` };
  return { tone: daysLate === 0 ? "today" : "future", label: dueLabel(dueAt, hasTime, now) };
}

/**
 * "Today", "Yesterday", "Tomorrow", or the short date ("Nov 3"), read in app
 * time. A day in another year than now's (app time again) carries its year,
 * "Nov 3, 2025", so last year's history never reads as this year's.
 */
export function dayLabel(date: Date, now: Date): string {
  const today = dateInputValue(now);
  const day = dateInputValue(date);
  if (day === today) return "Today";
  if (day === addDaysToDateString(today, -1)) return "Yesterday";
  if (day === addDaysToDateString(today, 1)) return "Tomorrow";
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return formatDate(date, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/**
 * "2:00 PM": the clock time in app time. Newer Intl puts a narrow no-break
 * space before AM/PM and older engines a plain one; it is always a plain space
 * here, so the server's render and the browser's agree.
 */
export function clockTime(date: Date): string {
  return date
    .toLocaleTimeString("en-US", { timeZone: APP_TIME_ZONE, hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, " ");
}

/** When an activity is due: "Tomorrow", or "Tomorrow, 2:00 PM" when a time was chosen (`hasTime`). App time. */
export function dueLabel(dueAt: Date, hasTime: boolean, now: Date): string {
  const day = dayLabel(dueAt, now);
  return hasTime ? `${day}, ${clockTime(dueAt)}` : day;
}

/** Calendar days a deal has been in its stage. 0 when it entered today (or, from clock drift, later). */
export function daysInStage(stageEnteredAt: Date, now: Date): number {
  return Math.max(0, calendarDaysBetween(dateInputValue(stageEnteredAt), dateInputValue(now)));
}

/** A deal rots once it has sat in the stage for the stage's limit. A stage with no limit never rots it. */
export function isRotting(days: number, rottingDays: number | null): boolean {
  return rottingDays !== null && days >= rottingDays;
}

/** When an activity is due: the chosen time on that day, or the end of the day when no time was chosen. Both in app time. */
export function activityDueAt(dueDate: string, dueTime: string | null): Date {
  return dueTime ? zonedDateTime(dueDate, dueTime) : endOfDay(dueDate);
}

/** True only for a real calendar date written "YYYY-MM-DD" ("2026-02-30" is not one). */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
