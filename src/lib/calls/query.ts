import { APP_TIME_ZONE, formatDate, startOfDay } from "@/lib/utils";

/**
 * URL query parsing + serialization for the Calls view. Keeps every filter in
 * the URL so Back/Forward restore the view, every link is shareable, and the
 * CSV export can reuse the exact same parser as the page.
 *
 * Calendar ranges (today, this week, last month, custom dates...) use the
 * team's days in Charlotte (the app time zone), not the server's, so "Today"
 * at 9pm Eastern is still today. Weeks run Monday to Sunday.
 */

const RANGES = [
  "today",
  "yesterday",
  "thisweek",
  "lastweek",
  "7d",
  "14d",
  "30d",
  "90d",
  "month",
  "lastmonth",
  "custom",
] as const;
export type CallsRange = (typeof RANGES)[number];

const STATUSES = ["all", "answered", "missed", "first", "repeat"] as const;
export type CallsStatus = (typeof STATUSES)[number];

export type CallsQuery = {
  range: CallsRange;
  /** First day of a custom range, "YYYY-MM-DD". Only set when range is "custom". */
  from: string | null;
  /** Last day (included) of a custom range, "YYYY-MM-DD". Only set when range is "custom". */
  to: string | null;
  clientId: string | null;
  trackingNumber: string | null;
  status: CallsStatus;
  page: number;
};

export const DEFAULT_CALLS_QUERY: CallsQuery = {
  range: "7d",
  from: null,
  to: null,
  clientId: null,
  trackingNumber: null,
  status: "all",
  page: 1,
};

/** The longest custom range, in days (one year, leap year included). */
export const MAX_CUSTOM_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Date-string helpers ("YYYY-MM-DD"). Plain calendar arithmetic, done in UTC
// so the server's own time zone never gets involved.
// ---------------------------------------------------------------------------

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function dayNumber(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function addDays(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today's date in Charlotte as "YYYY-MM-DD", for the given clock. */
function dateInAppZone(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

/** Whole days in a custom range, both dates included. */
export function customRangeDays(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

/** What is wrong with a custom range, in plain words, or null when it is fine. */
export function validateCustomRange(
  from: string | null | undefined,
  to: string | null | undefined,
): string | null {
  if (!from || !to || !isRealDate(from) || !isRealDate(to)) return "Choose both dates.";
  if (to < from) return "The end date must be on or after the start date.";
  if (customRangeDays(from, to) > MAX_CUSTOM_RANGE_DAYS) return "Choose a range of one year or less.";
  return null;
}

/** Where a custom range starts when someone picks "Custom range": the last 7 days, ending today. */
export function defaultCustomRange(now: Date): { from: string; to: string } {
  const to = dateInAppZone(now);
  return { from: addDays(to, -6), to };
}

// ---------------------------------------------------------------------------
// Parse + serialize
// ---------------------------------------------------------------------------

function pickString(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim().length > 0) return raw;
  return null;
}

export function parseCallsQuery(raw: Record<string, string | string[] | undefined>): CallsQuery {
  const first = (k: string): string | null => {
    const v = raw[k];
    if (Array.isArray(v)) return pickString(v[0]);
    return pickString(v);
  };
  const r = first("range") ?? "";
  const s = first("status") ?? "";
  const pageNum = Number.parseInt(first("page") ?? "1", 10);

  let range: CallsRange = (RANGES as readonly string[]).includes(r) ? (r as CallsRange) : "7d";
  let from: string | null = null;
  let to: string | null = null;
  if (range === "custom") {
    const fromRaw = first("from");
    const toRaw = first("to");
    // A custom range that is incomplete or wrong falls back to the default
    // rather than showing an empty or enormous window.
    if (fromRaw && toRaw && validateCustomRange(fromRaw, toRaw) === null) {
      from = fromRaw;
      to = toRaw;
    } else {
      range = "7d";
    }
  }

  return {
    range,
    from,
    to,
    clientId: first("client"),
    trackingNumber: first("tracking"),
    status: (STATUSES as readonly string[]).includes(s) ? (s as CallsStatus) : "all",
    page: Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1,
  };
}

export function callsQueryToSearch(q: CallsQuery): string {
  const p = new URLSearchParams();
  if (q.range !== "7d") p.set("range", q.range);
  if (q.range === "custom" && q.from && q.to) {
    p.set("from", q.from);
    p.set("to", q.to);
  }
  if (q.clientId) p.set("client", q.clientId);
  if (q.trackingNumber) p.set("tracking", q.trackingNumber);
  if (q.status !== "all") p.set("status", q.status);
  if (q.page !== 1) p.set("page", String(q.page));
  return p.toString();
}

// ---------------------------------------------------------------------------
// Ranges -> a real window of time
// ---------------------------------------------------------------------------

/**
 * Resolve a range to a {start, end} window. `start` is included and `end` is
 * not. Ranges that include today end at `now`; past ranges end at the start of
 * the next day. The rolling ranges (7d, 14d, 30d, 90d) count back from `now`.
 */
export function rangeWindow(
  range: CallsRange,
  now: Date,
  from?: string | null,
  to?: string | null,
): { start: Date; end: Date } {
  const rolling = (days: number) => ({ start: new Date(now.getTime() - days * DAY_MS), end: now });

  const today = dateInAppZone(now);
  const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const monday = addDays(today, -((dayOfWeek + 6) % 7));
  const firstOfThisMonth = `${today.slice(0, 8)}01`;

  switch (range) {
    case "today":
      return { start: startOfDay(today), end: now };
    case "yesterday":
      return { start: startOfDay(addDays(today, -1)), end: startOfDay(today) };
    case "thisweek":
      return { start: startOfDay(monday), end: now };
    case "lastweek":
      return { start: startOfDay(addDays(monday, -7)), end: startOfDay(monday) };
    case "7d":
      return rolling(7);
    case "14d":
      return rolling(14);
    case "30d":
      return rolling(30);
    case "90d":
      return rolling(90);
    case "month":
      return { start: startOfDay(firstOfThisMonth), end: now };
    case "lastmonth": {
      const lastDayOfPreviousMonth = addDays(firstOfThisMonth, -1);
      const firstOfPreviousMonth = `${lastDayOfPreviousMonth.slice(0, 8)}01`;
      return { start: startOfDay(firstOfPreviousMonth), end: startOfDay(firstOfThisMonth) };
    }
    case "custom":
      if (from && to && validateCustomRange(from, to) === null) {
        return { start: startOfDay(from), end: startOfDay(addDays(to, 1)) };
      }
      return rolling(7);
    default:
      return rolling(7);
  }
}

export function rangeLabel(range: CallsRange, from?: string | null, to?: string | null): string {
  switch (range) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "thisweek":
      return "This week (Mon to Sun)";
    case "lastweek":
      return "Last week (Mon to Sun)";
    case "7d":
      return "Last 7 days";
    case "14d":
      return "Last 14 days";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "month":
      return "This month";
    case "lastmonth":
      return "Last month";
    case "custom": {
      if (!from || !to) return "Custom range";
      const fmt = (d: string) => formatDate(startOfDay(d), { month: "short", day: "numeric", year: "numeric" });
      return `${fmt(from)} to ${fmt(to)}`;
    }
    default:
      return "Last 7 days";
  }
}

export const CALLS_PAGE_SIZE = 20;
