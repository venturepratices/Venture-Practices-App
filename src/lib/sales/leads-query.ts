// What the Leads Inbox reads from its URL: whose leads and the search. No
// prisma and no server imports, so the server page, the toolbar and the "Show
// more" fetch all share one parser and one serializer.

const SCOPES = ["everyone", "mine"] as const;

const SEARCH_MAX = 100;
/** A search shorter than this is ignored (spec 7.4: filter from two letters). */
const SEARCH_MIN = 2;
const CURSOR_MAX = 64;

export type LeadsQuery = {
  scope: (typeof SCOPES)[number];
  q: string;
  /** Page cursor for "Show more" requests. Never written to a page URL. */
  cursor: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

/** The first value when a param is repeated (?scope=mine&scope=everyone). */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Reads the Leads Inbox URL. Anything missing or invalid falls back to its
 * default (everyone's leads, no search), so a hand-edited or stale link never
 * fails.
 */
export function parseLeadsQuery(params: RawParams): LeadsQuery {
  const scope = first(params.scope);
  const search = (first(params.q) ?? "").trim().slice(0, SEARCH_MAX);
  const cursor = first(params.cursor);
  return {
    scope: SCOPES.find((candidate) => candidate === scope) ?? "everyone",
    q: search.length < SEARCH_MIN ? "" : search,
    cursor: cursor !== undefined && cursor.length >= 1 && cursor.length <= CURSOR_MAX ? cursor : null,
  };
}

/**
 * The query string (no leading "?") for a Leads Inbox query. Writes only values
 * that differ from the defaults, in the order scope, q, and never the cursor.
 */
export function leadsQueryToSearch(query: LeadsQuery): string {
  const search = new URLSearchParams();
  if (query.scope !== "everyone") search.set("scope", query.scope);
  if (query.q) search.set("q", query.q);
  return search.toString();
}
