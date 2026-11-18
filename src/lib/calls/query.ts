/**
 * URL query parsing + serialization for the Calls view. Keeps every filter in
 * the URL so Back/Forward restore the view, every link is shareable, and the
 * CSV export can reuse the exact same parser as the page.
 */

const RANGES = ["7d", "14d", "30d", "month"] as const;
export type CallsRange = (typeof RANGES)[number];

const STATUSES = ["all", "answered", "missed", "first", "repeat"] as const;
export type CallsStatus = (typeof STATUSES)[number];

export type CallsQuery = {
  range: CallsRange;
  clientId: string | null;
  trackingNumber: string | null;
  status: CallsStatus;
  page: number;
};

export const DEFAULT_CALLS_QUERY: CallsQuery = {
  range: "7d",
  clientId: null,
  trackingNumber: null,
  status: "all",
  page: 1,
};

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
  return {
    range: (RANGES as readonly string[]).includes(r) ? (r as CallsRange) : "7d",
    clientId: first("client"),
    trackingNumber: first("tracking"),
    status: (STATUSES as readonly string[]).includes(s) ? (s as CallsStatus) : "all",
    page: Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1,
  };
}

export function callsQueryToSearch(q: CallsQuery): string {
  const p = new URLSearchParams();
  if (q.range !== "7d") p.set("range", q.range);
  if (q.clientId) p.set("client", q.clientId);
  if (q.trackingNumber) p.set("tracking", q.trackingNumber);
  if (q.status !== "all") p.set("status", q.status);
  if (q.page !== 1) p.set("page", String(q.page));
  return p.toString();
}

/** Resolve a range to a {start, end} window, with `end` set to `now`. */
export function rangeWindow(range: CallsRange, now: Date): { start: Date; end: Date } {
  const end = now;
  const start = new Date(now);
  if (range === "7d") start.setDate(start.getDate() - 7);
  else if (range === "14d") start.setDate(start.getDate() - 14);
  else if (range === "30d") start.setDate(start.getDate() - 30);
  else if (range === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

export function rangeLabel(range: CallsRange): string {
  if (range === "7d") return "Last 7 days";
  if (range === "14d") return "Last 14 days";
  if (range === "30d") return "Last 30 days";
  return "This month";
}

export const CALLS_PAGE_SIZE = 20;
