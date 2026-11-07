import { z } from "zod";

import { SAVED_VIEW_NAME_MAX, SAVED_VIEWS_MAX } from "@/lib/sales/constants";

// What the Deals page reads from its URL: which pipeline, board or list, whose
// deals, and the filters. Pure (zod and the client-safe constants only), so the
// server page, the toolbar and the "Show more" route all share one parser and
// one serializer, and so do a person's saved views.

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
  /**
   * A stage key from the URL (the Filter menu's Stage, or a saved view). Read
   * among the shown pipeline's live stages by the loader; a key that is gone is
   * ignored, so every stage shows.
   */
  stage: string | null;
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

const VIEW_LIMIT = `You can keep up to ${SAVED_VIEWS_MAX} views. Remove one first.`;
const VIEW_NAME_TAKEN = "You already have a view with that name.";

/** One named Deals view (Decision 29): everything the board shows but the page cursor. No history row. */
export const savedBoardViewSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, "Give the view a name.")
    .max(SAVED_VIEW_NAME_MAX, `Keep the name under ${SAVED_VIEW_NAME_MAX} characters.`),
  /** Null: the view applies on whichever pipeline is shown. */
  pipeline: z.string().min(1).max(KEY_MAX).nullable(),
  view: z.enum(VIEWS),
  scope: z.enum(SCOPES),
  status: z.enum(STATUSES),
  next: z.enum(NEXT_STEPS),
  stage: z.string().min(1).max(KEY_MAX).nullable(),
  q: z.string().max(SEARCH_MAX),
});

export type SavedBoardView = z.infer<typeof savedBoardViewSchema>;

/**
 * A person's saved views: at most 20, names unique ignoring case (compared as
 * stored, trimmed). The limit is checked before any view is read, so a list
 * that is too long is refused with that one message and costs no more work.
 */
export const savedViewsSchema = z
  .array(z.unknown())
  .max(SAVED_VIEWS_MAX, VIEW_LIMIT)
  .pipe(
    z.array(savedBoardViewSchema).superRefine((views, ctx) => {
      const seen = new Set<string>();
      for (const [index, view] of views.entries()) {
        const name = view.name.toLowerCase();
        if (seen.has(name)) {
          ctx.addIssue({ code: "custom", message: VIEW_NAME_TAKEN, path: [index, "name"] });
          return;
        }
        seen.add(name);
      }
    }),
  );

/** The board query a saved view opens: its own filters, from the first page. */
export function savedViewToQuery(view: SavedBoardView): BoardQuery {
  return {
    pipeline: view.pipeline,
    view: view.view,
    scope: view.scope,
    status: view.status,
    next: view.next,
    stage: view.stage,
    q: view.q,
    cursor: null,
  };
}

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
    stage: keyOrNull(first(params.stage)),
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
  if (query.stage) search.set("stage", query.stage);
  if (query.q) search.set("q", query.q);
  return search.toString();
}
