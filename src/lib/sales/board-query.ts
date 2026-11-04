import { z } from "zod";

// What the Deals page reads from its URL: which pipeline, board or list, whose
// deals, and the filters. Pure (zod only), so the server page, the toolbar and
// the "Show more" route all share one parser and one serializer.

const VIEWS = ["board", "list"] as const;
const SCOPES = ["everyone", "mine"] as const;
const STATUSES = ["open", "won", "lost"] as const;
const NEXT_STEPS = ["any", "overdue", "today", "none"] as const;

const SEARCH_MAX = 100;
/** A search shorter than this is ignored (spec 7.4: filter from two letters). */
const SEARCH_MIN = 2;
const KEY_MAX = 64;

export type BoardQuery = {
  /** A pipeline key from the URL. Not checked against real pipelines here: the loader falls back to the first one. */
  pipeline: string | null;
  view: (typeof VIEWS)[number];
  scope: (typeof SCOPES)[number];
  status: (typeof STATUSES)[number];
  next: (typeof NEXT_STEPS)[number];
  q: string;
  /** Page cursor for "Show more" requests. Never written to a page URL. */
  cursor: string | null;
};

/** The per-person remembered view (TeamMember.salesDefaultView). */
export const savedViewSchema = z.strictObject({
  pipeline: z.string().min(1).max(KEY_MAX).nullable(),
  view: z.enum(VIEWS),
  scope: z.enum(SCOPES),
});

export type SavedView = z.infer<typeof savedViewSchema>;

type RawParams = Record<string, string | string[] | undefined>;

/** The first value when a param is repeated (?view=list&view=board). */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

function keyOrNull(value: string | undefined): string | null {
  return value !== undefined && value.length >= 1 && value.length <= KEY_MAX ? value : null;
}

/**
 * Reads the Deals page URL. Anything missing or invalid falls back to its
 * default, so a hand-edited or stale link never fails. The remembered `saved`
 * view fills in pipeline, view and scope only when the URL names none of the
 * three; a malformed saved value is ignored whole.
 */
export function parseBoardQuery(params: RawParams, saved?: unknown): BoardQuery {
  const pipeline = first(params.pipeline);
  const view = first(params.view);
  const scope = first(params.scope);

  const remembered =
    pipeline === undefined && view === undefined && scope === undefined ? savedViewSchema.safeParse(saved) : null;
  const base = remembered?.success ? remembered.data : null;

  const search = (first(params.q) ?? "").trim().slice(0, SEARCH_MAX);

  return {
    pipeline: base ? base.pipeline : keyOrNull(pipeline),
    view: base ? base.view : oneOf(view, VIEWS, "board"),
    scope: base ? base.scope : oneOf(scope, SCOPES, "everyone"),
    status: oneOf(first(params.status), STATUSES, "open"),
    next: oneOf(first(params.next), NEXT_STEPS, "any"),
    q: search.length < SEARCH_MIN ? "" : search,
    cursor: keyOrNull(first(params.cursor)),
  };
}

/**
 * The query string (no leading "?") for a board query. Writes only values that
 * differ from the defaults, in a fixed order, and never the cursor.
 */
export function boardQueryToSearch(query: BoardQuery): string {
  const search = new URLSearchParams();
  if (query.pipeline) search.set("pipeline", query.pipeline);
  if (query.view !== "board") search.set("view", query.view);
  if (query.scope !== "everyone") search.set("scope", query.scope);
  if (query.status !== "open") search.set("status", query.status);
  if (query.next !== "any") search.set("next", query.next);
  if (query.q) search.set("q", query.q);
  return search.toString();
}
