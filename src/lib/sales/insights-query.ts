// What the Insights page reads from its URL: how many months back, whose deals
// and activities, and which pipeline the funnel draws. No prisma and no server
// imports, so the server page and the page's own controls share one parser and
// one serializer.

const RANGES = [3, 6, 12] as const;
const SCOPES = ["everyone", "mine"] as const;
const KEY_MAX = 64;

export type InsightsRange = (typeof RANGES)[number];

export type InsightsQuery = {
  /** Months covered, ending with this app-time month: "Last 3 months" (the default), 6 or 12. */
  range: InsightsRange;
  scope: (typeof SCOPES)[number];
  /** A pipeline key for the funnel. Not checked against real pipelines here: the loader falls back to the first one. */
  pipeline: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

/** The first value when a param is repeated (?range=6&range=12). */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Reads the Insights URL. Anything missing or invalid falls back to its default
 * (the last 3 months, everyone's, the first pipeline), so a hand-edited or stale
 * link never fails.
 */
export function parseInsightsQuery(params: RawParams): InsightsQuery {
  const range = first(params.range);
  const scope = first(params.scope);
  const pipeline = first(params.pipeline);
  return {
    range: RANGES.find((candidate) => String(candidate) === range) ?? 3,
    scope: SCOPES.find((candidate) => candidate === scope) ?? "everyone",
    pipeline: pipeline !== undefined && pipeline.length >= 1 && pipeline.length <= KEY_MAX ? pipeline : null,
  };
}

/**
 * The query string (no leading "?") for an Insights query. Writes only values
 * that differ from the defaults, in a fixed order: range, scope, pipeline.
 */
export function insightsQueryToSearch(query: InsightsQuery): string {
  const search = new URLSearchParams();
  if (query.range !== 3) search.set("range", String(query.range));
  if (query.scope !== "everyone") search.set("scope", query.scope);
  if (query.pipeline) search.set("pipeline", query.pipeline);
  return search.toString();
}
