/**
 * Stats data model and helpers for the Marketing > Stats screen.
 *
 * Pure module: no database, no network. Today every number is zero because
 * every flow is still in Draft. A later PR swaps `getInsights` for a real
 * NitroSend call (see app-builder-handover/06-STATS-DASHBOARD-SPEC.md).
 */

import type { SequenceKey } from "./sequences";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Time window the numbers cover. */
export type InsightsWindow = "7d" | "30d" | "all";

/** The nine metric tiles on the Stats screen. */
export type MetricKey =
  | "sends"
  | "deliveryRate"
  | "openRate"
  | "clickRate"
  | "replyRate"
  | "bookingRate"
  | "unsubscribeRate"
  | "spamComplaintRate"
  | "bounceRate";

/** Traffic-light state for one metric (or a whole sequence). */
export type MetricHealth = "green" | "yellow" | "red" | "no-data" | "not-wired";

/** Aggregate numbers for one sequence at one window (04-DATA-MODEL.md). */
export interface Insights {
  sends: number;
  delivered: number;
  /** 0.0 to 1.0 */
  deliveryRate: number;
  /** Unique opens. */
  opens: number;
  openRate: number;
  /** Unique clicks. */
  clicks: number;
  clickRate: number;
  /** 0 until Gmail is connected in NitroSend. */
  replies: number;
  replyRate: number;
  /** From the appointment_booked event. */
  bookings: number;
  bookingRate: number;
  unsubscribes: number;
  unsubscribeRate: number;
  spamComplaints: number;
  spamComplaintRate: number;
  bounces: number;
  bounceRate: number;
  window: InsightsWindow;
  /** Keyed by templateId. */
  perEmail: Record<string, Omit<Insights, "window" | "perEmail">>;
}

/** The same sequence read at all three windows. */
export interface WindowedInsights {
  "7d": Insights;
  "30d": Insights;
  all: Insights;
}

// ---------------------------------------------------------------------------
// Thresholds and health
// ---------------------------------------------------------------------------

/**
 * Metrics we cannot measure yet. Reply rate needs Gmail connected in
 * NitroSend. Booking rate needs the appointment-booked GHL workflow published.
 * The UI shows a dash and a warning instead of "0%" for these.
 */
export const NOT_WIRED_METRICS: ReadonlySet<MetricKey> = new Set<MetricKey>([
  "replyRate",
  "bookingRate",
]);

interface HigherIsBetter {
  direction: "higher";
  /** At or above this is green only when strictly greater. */
  green: number;
  /** Below this is red. */
  red: number;
}

interface LowerIsBetter {
  direction: "lower";
  /** Strictly below this is green. */
  green: number;
  /** Strictly above this is red. */
  red: number;
}

type Threshold = HigherIsBetter | LowerIsBetter;

/** Green/yellow/red cut-offs from 06-STATS-DASHBOARD-SPEC.md. */
const THRESHOLDS: Partial<Record<MetricKey, Threshold>> = {
  openRate: { direction: "higher", green: 0.25, red: 0.15 },
  clickRate: { direction: "higher", green: 0.03, red: 0.01 },
  replyRate: { direction: "higher", green: 0.02, red: 0.005 },
  bounceRate: { direction: "lower", green: 0.01, red: 0.02 },
  spamComplaintRate: { direction: "lower", green: 0.0005, red: 0.001 },
  unsubscribeRate: { direction: "lower", green: 0.003, red: 0.005 },
};

/**
 * Classify one metric. Not-wired metrics always say "not-wired". With no sends
 * there is nothing to judge, and metrics without a threshold (sends, delivery,
 * booking) are "no-data" because the spec gives them no colors.
 */
export function metricHealth(key: MetricKey, value: number, sends: number): MetricHealth {
  if (NOT_WIRED_METRICS.has(key)) return "not-wired";
  if (sends === 0) return "no-data";
  const t = THRESHOLDS[key];
  if (!t) return "no-data";
  if (t.direction === "higher") {
    if (value > t.green) return "green";
    if (value < t.red) return "red";
    return "yellow";
  }
  if (value < t.green) return "green";
  if (value > t.red) return "red";
  return "yellow";
}

const HEALTH_RANK: Record<MetricHealth, number> = {
  red: 4,
  yellow: 3,
  green: 2,
  "no-data": 1,
  "not-wired": 0,
};

const ALL_METRICS: readonly MetricKey[] = [
  "sends",
  "deliveryRate",
  "openRate",
  "clickRate",
  "replyRate",
  "bookingRate",
  "unsubscribeRate",
  "spamComplaintRate",
  "bounceRate",
];

/**
 * Worst color across wired metrics that have data. Returns "no-data" when
 * nothing has sent yet. Not-wired metrics never drag the overall color down.
 */
export function sequenceHealth(insights: Insights): MetricHealth {
  let worst: MetricHealth = "no-data";
  for (const key of ALL_METRICS) {
    const h = metricHealth(key, insights[key], insights.sends);
    if (h === "not-wired") continue;
    if (HEALTH_RANK[h] > HEALTH_RANK[worst]) worst = h;
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function emptyInsights(window: InsightsWindow): Insights {
  return {
    sends: 0,
    delivered: 0,
    deliveryRate: 0,
    opens: 0,
    openRate: 0,
    clicks: 0,
    clickRate: 0,
    replies: 0,
    replyRate: 0,
    bookings: 0,
    bookingRate: 0,
    unsubscribes: 0,
    unsubscribeRate: 0,
    spamComplaints: 0,
    spamComplaintRate: 0,
    bounces: 0,
    bounceRate: 0,
    window,
    perEmail: {},
  };
}

function emptyWindowed(): WindowedInsights {
  return {
    "7d": emptyInsights("7d"),
    "30d": emptyInsights("30d"),
    all: emptyInsights("all"),
  };
}

/**
 * Hand-maintained snapshot. Currently all zeros because every flow is in
 * Draft (see app-builder-handover/03-WHAT-ALREADY-EXISTS.md). Swapped out
 * for a real NitroSend HTTP client in a later PR once the API key lands.
 */
export const MOCK_INSIGHTS: Record<SequenceKey, WindowedInsights> = {
  cold: emptyWindowed(),
  marketing: emptyWindowed(),
  sales: emptyWindowed(),
  postproposal: emptyWindowed(),
  nurture: emptyWindowed(),
  newsletter: emptyWindowed(),
};

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * Read insights for a sequence at a window. Right now returns the mock; a
 * later PR replaces the body with a call to NitroSend's HTTP API (the
 * nitro_get_insights equivalent). Keep the signature stable so the UI change
 * is zero-line. Real data must skip archived flows (flow 19487 holds dry-run
 * sends that would pollute "all").
 *
 * TODO(nitrosend-api-key): replace the mock lookup with a server-side fetch:
 *   const r = await fetch(`${process.env.NITROSEND_BASE}/insights?flow_id=${flowId}&window=${window}`, { headers: { Authorization: `Bearer ${process.env.NITROSEND_API_KEY}` } });
 */
export async function getInsights(key: SequenceKey, window: InsightsWindow): Promise<Insights> {
  return MOCK_INSIGHTS[key][window];
}

const SEQUENCE_KEYS: readonly SequenceKey[] = [
  "cold",
  "marketing",
  "sales",
  "postproposal",
  "nurture",
  "newsletter",
];

/** Get every sequence's insights for one window, in one call. */
export async function getAllInsights(
  window: InsightsWindow,
): Promise<Record<SequenceKey, Insights>> {
  const results = await Promise.all(SEQUENCE_KEYS.map((k) => getInsights(k, window)));
  const out = {} as Record<SequenceKey, Insights>;
  SEQUENCE_KEYS.forEach((k, i) => {
    out[k] = results[i];
  });
  return out;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Short tile titles for each metric. */
export const METRIC_LABEL: Record<MetricKey, string> = {
  sends: "Sends",
  deliveryRate: "Delivery",
  openRate: "Open rate",
  clickRate: "Click rate",
  replyRate: "Reply rate",
  bookingRate: "Booking rate",
  unsubscribeRate: "Unsubscribe",
  spamComplaintRate: "Spam",
  bounceRate: "Bounce",
};

/** Short one-line explanation shown in a tooltip when a metric is "not-wired". */
export const NOT_WIRED_REASON: Record<MetricKey, string | null> = {
  sends: null,
  deliveryRate: null,
  openRate: null,
  clickRate: null,
  replyRate: "Reply tracking goes live when Ben connects Gmail in NitroSend.",
  bookingRate: "Booking tracking goes live when the GHL appointment-booked workflow is published.",
  unsubscribeRate: null,
  spamComplaintRate: null,
  bounceRate: null,
};
