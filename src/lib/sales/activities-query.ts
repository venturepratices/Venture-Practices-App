import type { SalesActivityType } from "@/generated/prisma/enums";
import { ACTIVITY_TYPES } from "@/lib/sales/constants";

// What the Activities page reads from its URL: which activities (to do,
// overdue, due today, done), which type, and whose. No prisma and no server
// imports (the type import above is erased at build time), so the server page,
// the filter buttons and the "Show more" fetch all share one parser and one
// serializer.

const WHENS = ["open", "overdue", "today", "done"] as const;
const SCOPES = ["everyone", "mine"] as const;
const CURSOR_MAX = 64;

export type ActivitiesQuery = {
  when: (typeof WHENS)[number];
  type: SalesActivityType | "all";
  scope: (typeof SCOPES)[number];
  /** Page cursor for "Show more" requests. Never written to a page URL. */
  cursor: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

/** The first value when a param is repeated (?when=today&when=done). */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/**
 * Reads the Activities page URL. Anything missing or invalid falls back to its
 * default (every open activity, every type, everyone's), so a hand-edited or
 * stale link never fails.
 */
export function parseActivitiesQuery(params: RawParams): ActivitiesQuery {
  const cursor = first(params.cursor);
  return {
    when: oneOf(first(params.when), WHENS, "open"),
    type: oneOf<SalesActivityType | "all">(first(params.type), ACTIVITY_TYPES, "all"),
    scope: oneOf(first(params.scope), SCOPES, "everyone"),
    cursor: cursor !== undefined && cursor.length >= 1 && cursor.length <= CURSOR_MAX ? cursor : null,
  };
}

/**
 * The query string (no leading "?") for an Activities query. Writes only values
 * that differ from the defaults, in a fixed order, and never the cursor.
 */
export function activitiesQueryToSearch(query: ActivitiesQuery): string {
  const search = new URLSearchParams();
  if (query.when !== "open") search.set("when", query.when);
  if (query.type !== "all") search.set("type", query.type);
  if (query.scope !== "everyone") search.set("scope", query.scope);
  return search.toString();
}
