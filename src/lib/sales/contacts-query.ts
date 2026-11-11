// What the Contacts page reads from its URL: which tab, whose contacts and the
// search. No prisma and no server imports, so the server page, the toolbar,
// the contact links and the "Show more" fetch all share one parser and one
// serializer.

export type ContactKind = "person" | "organization";

/** The path segment of each kind in `/api/sales/contacts/<segment>` and the tab it is on. */
export const CONTACT_PATHS: Record<ContactKind, "people" | "organizations"> = {
  person: "people",
  organization: "organizations",
};

/** The kind a path segment names, or null for any other segment. */
export function contactKindFromPath(segment: string): ContactKind | null {
  if (segment === CONTACT_PATHS.person) return "person";
  if (segment === CONTACT_PATHS.organization) return "organization";
  return null;
}

const TABS = ["people", "organizations"] as const;
const SCOPES = ["everyone", "mine"] as const;

const SEARCH_MAX = 100;
/** A search shorter than this is ignored (spec 7.4: filter from two letters). */
const SEARCH_MIN = 2;
const CURSOR_MAX = 64;

export type ContactsQuery = {
  tab: (typeof TABS)[number];
  /** "mine" = contacts I own; "everyone" = every contact I may see. */
  scope: (typeof SCOPES)[number];
  q: string;
  /** Page cursor for "Show more" requests. Never written to a page URL. */
  cursor: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

/** The first value when a param is repeated (?tab=people&tab=organizations). */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Reads the Contacts URL. Anything missing or invalid falls back to its default
 * (People, every contact this person may see, no search), so a hand-edited or
 * stale link never fails.
 */
export function parseContactsQuery(params: RawParams): ContactsQuery {
  const tab = first(params.tab);
  const scope = first(params.scope);
  const search = (first(params.q) ?? "").trim().slice(0, SEARCH_MAX);
  const cursor = first(params.cursor);
  return {
    tab: TABS.find((candidate) => candidate === tab) ?? "people",
    scope: SCOPES.find((candidate) => candidate === scope) ?? "everyone",
    q: search.length < SEARCH_MIN ? "" : search,
    cursor: cursor !== undefined && cursor.length >= 1 && cursor.length <= CURSOR_MAX ? cursor : null,
  };
}

/**
 * The query string (no leading "?") for a Contacts query. Writes only values
 * that differ from the defaults, in the order tab, scope, q, and never the cursor.
 */
export function contactsQueryToSearch(query: ContactsQuery): string {
  const search = new URLSearchParams();
  if (query.tab !== "people") search.set("tab", query.tab);
  if (query.scope !== "everyone") search.set("scope", query.scope);
  if (query.q) search.set("q", query.q);
  return search.toString();
}
