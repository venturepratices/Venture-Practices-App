// The read-only Pipedrive client the one-time import runs on. It can read and
// nothing else: the only request it can build is a GET, and no method, body or
// verb is a parameter, so nothing here can change data inside Pipedrive.
//
// Callers pass the full path from the host root, so one client serves both API
// versions: "/api/v2/deals" for deals, people, organizations, activities,
// pipelines and stages (v2 uses a cursor: send `cursor`, read
// `additional_data.next_cursor`, null on the last page), and "/api/v1/notes" for
// notes, files, leads, deal fields, users and activity types (v1 uses an offset:
// send `start`, read `additional_data.pagination.next_start` while
// `more_items_in_collection` is true). Pipedrive's default page is 100 rows and
// the most it allows is 500 (100 for the files list); no `limit` means its default.
//
// The token goes in the `x-api-token` header and nowhere else. It is never in a
// URL, and an error never carries a URL, a query string or the token, so a log
// line or a screen that shows one cannot leak it.

const DEFAULT_BASE_URL = "https://api.pipedrive.com";

/** Retries after the first try, so one call makes at most 5 requests. */
const MAX_RETRIES = 4;
/** Waits 1s, 2s, 4s, then 8s when Pipedrive names no wait of its own. */
const BACKOFF_BASE_MS = 1000;
/** One wait never exceeds this, so a huge Retry-After cannot park an import run for an hour. */
const MAX_WAIT_MS = 30_000;
/** A download may bounce through a few redirects (Pipedrive to its file store), not forever. */
const MAX_REDIRECTS = 3;
/** Pipedrive's own words in an error are cut to this, so a long reply cannot flood a screen. */
const MAX_REASON_CHARS = 200;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const PREFIX = "Pipedrive request failed";

export class PipedriveError extends Error {
  /** The HTTP status Pipedrive answered with, or 0 when no answer came at all. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PipedriveError";
    this.status = status;
  }
}

export type PipedriveClient = {
  /** One array per page of the list at `path`, in order, until Pipedrive says there is no more. */
  pages<T>(
    path: string,
    opts?: { style?: "cursor" | "offset"; params?: Record<string, string | number>; limit?: number },
  ): AsyncGenerator<T[], void, void>;
  /** The raw bytes of a file, from "/api/v1/files/{id}/download". */
  download(path: string): Promise<{ bytes: Uint8Array; contentType: string }>;
};

export function createPipedriveClient(opts: {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): PipedriveClient {
  // A token pasted into an env var often carries a trailing newline, which is
  // not a legal header value, so it is trimmed here once.
  const token = opts.token.trim();
  if (token === "") throw new Error("A Pipedrive API token is required.");

  const base = new URL(opts.baseUrl ?? DEFAULT_BASE_URL);
  // Looked up at call time, not now, so the host's own fetch is the one used.
  const fetchImpl: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  /**
   * A full URL under the Pipedrive host. A path that points anywhere else is
   * refused, so the token cannot be sent off to another site.
   */
  function buildUrl(path: string, params: Record<string, string | number> = {}): URL {
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw new Error("A Pipedrive path must stay on the Pipedrive host.");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url;
  }

  /**
   * One GET with retries. Gives back a 2xx or a redirect (redirects are never
   * followed automatically: the caller decides, so the token is not forwarded
   * to a host that is not Pipedrive). Retries a 429, a 5xx and a dropped
   * connection; any other failure throws at once, since asking again cannot
   * change a 401 or a 404.
   */
  async function send(url: URL, withToken: boolean, accept: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      try {
        res = await fetchImpl(url.toString(), {
          method: "GET",
          headers: withToken ? { "x-api-token": token, Accept: accept } : { Accept: accept },
          redirect: "manual",
          cache: "no-store",
        });
      } catch {
        // The thrown error is dropped on purpose: a network failure's text can
        // quote the address it was calling.
      }
      if (res && (res.ok || REDIRECT_STATUSES.has(res.status))) return res;

      const status = res ? res.status : 0;
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) throw await failure(status, res, token);

      // Let go of the unread reply so its connection is freed; no need to wait for it.
      void res?.body?.cancel().catch(() => {});
      await sleep(waitMs(res, attempt));
    }
  }

  async function getJson(url: URL): Promise<Record<string, unknown>> {
    const res = await send(url, true, "application/json");
    if (REDIRECT_STATUSES.has(res.status)) {
      throw new PipedriveError(res.status, `${PREFIX} (HTTP ${res.status}): it answered with a redirect.`);
    }
    try {
      return asRecord(await res.json());
    } catch {
      throw new PipedriveError(res.status, `${PREFIX} (HTTP ${res.status}): the reply was not JSON.`);
    }
  }

  async function* pages<T>(
    path: string,
    pageOpts: { style?: "cursor" | "offset"; params?: Record<string, string | number>; limit?: number } = {},
  ): AsyncGenerator<T[], void, void> {
    const { style = "cursor", params = {}, limit } = pageOpts;

    let cursor: string | null = null;
    let start = 0;
    for (;;) {
      const query: Record<string, string | number> = { ...params };
      if (limit !== undefined) query.limit = limit;
      if (style === "offset") query.start = start;
      else if (cursor !== null) query.cursor = cursor;
      const body = await getJson(buildUrl(path, query));

      // Empty or null data means "nothing here", not a page to hand back.
      if (Array.isArray(body.data) && body.data.length > 0) yield body.data as T[];

      if (style === "cursor") {
        cursor = nextCursor(body);
        if (cursor === null) return;
      } else {
        const next = nextStart(body, start);
        if (next === null) return;
        start = next;
      }
    }
  }

  async function download(path: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    let url = buildUrl(path);
    let res = await send(url, true, "*/*");

    // The docs do not say whether this answers with the bytes or a redirect to a
    // file store. Either way works; the token only goes to the Pipedrive host.
    for (let hops = 0; REDIRECT_STATUSES.has(res.status); hops++) {
      const location = res.headers.get("location");
      if (location === null || hops >= MAX_REDIRECTS) {
        throw new PipedriveError(res.status, `${PREFIX} (HTTP ${res.status}): too many redirects or none to follow.`);
      }
      const next = new URL(location, url);
      const onPipedrive = next.origin === base.origin;
      if (!onPipedrive && next.protocol !== "https:") {
        throw new PipedriveError(res.status, `${PREFIX} (HTTP ${res.status}): it redirected somewhere not secure.`);
      }
      url = next;
      res = await send(url, onPipedrive, "*/*");
    }

    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  return { pages, download };
}

/**
 * What the admin screen may show about the token: whether it is set and its last
 * four characters, never more. Takes `process.env`, or any plain object of
 * strings (this repo's ProcessEnv type insists on NODE_ENV, which would make a
 * test pass a whole fake environment for one key).
 */
export function pipedriveTokenInfo(env: Record<string, string | undefined>): { set: boolean; last4: string | null } {
  const token = env.PIPEDRIVE_API_TOKEN?.trim();
  if (!token) return { set: false, last4: null };
  // A token under 8 characters would give away half of itself; real ones are 40.
  return { set: true, last4: token.length >= 8 ? token.slice(-4) : null };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The cursor for the next page, or null on the last one. v2 puts it at
 * `additional_data.next_cursor`; one Pipedrive guide shows it under
 * `additional_data.pagination` instead. Both are read, so a response shaped the
 * other way cannot quietly end an import after its first page.
 */
function nextCursor(body: Record<string, unknown>): string | null {
  const extra = asRecord(body.additional_data);
  const cursor = extra.next_cursor ?? asRecord(extra.pagination).next_cursor;
  return typeof cursor === "string" && cursor !== "" ? cursor : null;
}

/** Where the next offset page starts, or null on the last one. A start that does not move forward also stops, so a bad reply cannot loop. */
function nextStart(body: Record<string, unknown>, current: number): number | null {
  const pagination = asRecord(asRecord(body.additional_data).pagination);
  const next = pagination.next_start;
  return pagination.more_items_in_collection === true && typeof next === "number" && next > current ? next : null;
}

/** How long to wait before retrying: Retry-After in seconds if Pipedrive sends one (its docs do not promise it), else 1s, 2s, 4s, 8s. */
function waitMs(res: Response | null, attempt: number): number {
  const header = res?.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  const hinted = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
  return Math.min(hinted ?? BACKOFF_BASE_MS * 2 ** attempt, MAX_WAIT_MS);
}

/**
 * The error for a failed call. The message is the status, a fixed plain-words
 * reason, and Pipedrive's own `error` text if it sent a short one. That text is
 * scrubbed of the token and of the words "api_token" first, in case Pipedrive
 * ever echoes what it was sent. The request URL is never part of it.
 */
async function failure(status: number, res: Response | null, token: string): Promise<PipedriveError> {
  const reason = res ? await readReason(res, token) : null;
  const where = status === 0 ? "no reply" : `HTTP ${status}`;
  const said = reason === null ? "" : ` Pipedrive said: "${reason}"`;
  return new PipedriveError(status, `${PREFIX} (${where}): ${plainReason(status)}.${said}`);
}

function plainReason(status: number): string {
  if (status === 0) return "could not reach Pipedrive";
  if (status === 401) return "Pipedrive did not accept the API token";
  if (status === 403) return "Pipedrive refused the request (the token may lack access, or Pipedrive is blocking it after too many requests)";
  if (status === 404) return "not found in Pipedrive";
  if (status === 429) return "Pipedrive is rate limiting this token";
  if (status >= 500) return "Pipedrive had a server error";
  return "Pipedrive rejected the request";
}

async function readReason(res: Response, token: string): Promise<string | null> {
  try {
    const error = asRecord(await res.json()).error;
    if (typeof error !== "string") return null;
    const clean = error
      .replaceAll(token, "[redacted]")
      .replace(/api[_-]?token/gi, "[redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_REASON_CHARS);
    return clean === "" ? null : clean;
  } catch {
    // An HTML body (Cloudflare's 403 page) or no body: the fixed reason alone will do.
    return null;
  }
}
