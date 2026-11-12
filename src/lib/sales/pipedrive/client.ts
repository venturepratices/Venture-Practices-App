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
/** A request that has not answered by now is treated as a dropped connection: retried, then reported with status 0. */
const REQUEST_TIMEOUT_MS = 60_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const PREFIX = "Pipedrive request failed";
/** A failure on the far side of a download redirect is not Pipedrive's, and the message must not send anyone to look there. */
const FILE_HOST_PREFIX = "File download failed";

export class PipedriveError extends Error {
  /** The HTTP status Pipedrive answered with, or 0 when no answer came at all. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PipedriveError";
    this.status = status;
  }
}

export type PagesOptions = { style?: "cursor" | "offset"; params?: Record<string, string | number>; limit?: number };

/** Where a page starts: a v2 cursor, or a v1 offset. Saved by the import so a resume never re-reads a finished page. */
export type PageToken = { cursor: string } | { start: number };

export type PipedriveClient = {
  /** One array per page of the list at `path`, in order, until Pipedrive says there is no more. */
  pages<T>(path: string, opts?: PagesOptions): AsyncGenerator<T[], void, void>;
  /**
   * The same pages, each with `resumeAt`: where the NEXT page starts (null after
   * the last page). Pass a saved `resumeAt` back in to carry on from there. Empty
   * pages are given too, so their place can be saved.
   */
  pageBatches<T>(
    path: string,
    opts?: PagesOptions & { resumeAt?: PageToken },
  ): AsyncGenerator<{ items: T[]; resumeAt: PageToken | null }, void, void>;
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
  // The token is only ever sent to this host, so it must not be plain http.
  // Plain http is allowed for a local test server and nothing else.
  const localTestServer = base.protocol === "http:" && (base.hostname === "localhost" || base.hostname === "127.0.0.1");
  if (base.protocol !== "https:" && !localTestServer) throw new Error("The Pipedrive base URL must be https.");
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
   * connection or a timeout; any other failure throws at once, since asking
   * again cannot change a 401 or a 404. `withToken` is true exactly when `url`
   * is on the Pipedrive host, so it also decides whose failure a message names.
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
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // The thrown error is dropped on purpose: a network failure's text can
        // quote the address it was calling. A timeout lands here too.
      }
      if (res && (res.ok || REDIRECT_STATUSES.has(res.status))) return res;

      const status = res ? res.status : 0;
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) throw await failure(status, res, token, withToken);

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

  async function* pageBatches<T>(
    path: string,
    pageOpts: PagesOptions & { resumeAt?: PageToken } = {},
  ): AsyncGenerator<{ items: T[]; resumeAt: PageToken | null }, void, void> {
    const { style = "cursor", params = {}, limit, resumeAt } = pageOpts;
    if (resumeAt !== undefined && ("cursor" in resumeAt) !== (style === "cursor")) {
      throw new Error("The saved page position does not fit this list.");
    }

    let cursor: string | null = resumeAt && "cursor" in resumeAt ? resumeAt.cursor : null;
    // Every cursor used so far. Seeing one twice means Pipedrive is going in
    // circles, which would burn the company's request budget for nothing.
    const seen = new Set<string>(cursor === null ? [] : [cursor]);
    let start = resumeAt && "start" in resumeAt ? resumeAt.start : 0;
    for (;;) {
      const query: Record<string, string | number> = { ...params };
      if (limit !== undefined) query.limit = limit;
      if (style === "offset") query.start = start;
      else if (cursor !== null) query.cursor = cursor;
      const body = await getJson(buildUrl(path, query));
      const items = (Array.isArray(body.data) ? body.data : []) as T[];

      if (style === "cursor") {
        cursor = nextCursor(body);
        if (cursor === null) {
          yield { items, resumeAt: null };
          return;
        }
        // An error, not a quiet stop: a stop here would look like a complete copy.
        if (seen.has(cursor)) {
          throw new PipedriveError(200, "Pipedrive repeated a page cursor, so the copy stopped instead of looping.");
        }
        seen.add(cursor);
        yield { items, resumeAt: { cursor } };
      } else {
        const next = nextStart(body, start);
        if (next === null) {
          yield { items, resumeAt: null };
          return;
        }
        start = next;
        yield { items, resumeAt: { start } };
      }
    }
  }

  async function* pages<T>(path: string, pageOpts: PagesOptions = {}): AsyncGenerator<T[], void, void> {
    // Empty or null data means "nothing here", not a page to hand back.
    for await (const batch of pageBatches<T>(path, pageOpts)) if (batch.items.length > 0) yield batch.items;
  }

  async function download(path: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    let url = buildUrl(path);
    let onPipedrive = true;
    let res = await send(url, true, "*/*");

    // The docs do not say whether this answers with the bytes or a redirect to a
    // file store. Either way works; the token only goes to the Pipedrive host.
    for (let hops = 0; REDIRECT_STATUSES.has(res.status); hops++) {
      const location = res.headers.get("location");
      if (location === null || hops >= MAX_REDIRECTS) {
        throw redirectFailure(res.status, onPipedrive, "too many redirects or none to follow");
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw redirectFailure(res.status, onPipedrive, "the redirect had no usable destination");
      }
      const nextOnPipedrive = next.origin === base.origin;
      if (!nextOnPipedrive && next.protocol !== "https:") {
        throw redirectFailure(res.status, onPipedrive, "it redirected somewhere not secure");
      }
      url = next;
      onPipedrive = nextOnPipedrive;
      res = await send(url, onPipedrive, "*/*");
    }

    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  return { pages, pageBatches, download };
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
 * The cursor for the next page, or null on the last one (null or absent). v2
 * puts it at `additional_data.next_cursor`; one Pipedrive guide shows it under
 * `additional_data.pagination` instead. Both are read, so a response shaped the
 * other way cannot quietly end an import after its first page. A cursor that is
 * there but is not a non-empty string is an error: ending on it would look like
 * a complete copy with rows missing.
 */
function nextCursor(body: Record<string, unknown>): string | null {
  const extra = asRecord(body.additional_data);
  const cursor = extra.next_cursor ?? asRecord(extra.pagination).next_cursor;
  if (cursor === undefined || cursor === null) return null;
  if (typeof cursor === "string" && cursor !== "") return cursor;
  throw new PipedriveError(200, "Pipedrive sent a page cursor that is not usable, so the copy stopped instead of ending early.");
}

/**
 * Where the next offset page starts, or null on the last one. When Pipedrive
 * says there is more but the start is missing, not a number, or does not move
 * forward (it would loop), that is an error for the same reason as a bad cursor.
 */
function nextStart(body: Record<string, unknown>, current: number): number | null {
  const pagination = asRecord(asRecord(body.additional_data).pagination);
  if (pagination.more_items_in_collection !== true) return null;
  const next = pagination.next_start;
  if (typeof next === "number" && next > current) return next;
  throw new PipedriveError(
    200,
    "Pipedrive said there were more rows but gave no usable place to continue from, so the copy stopped instead of ending early.",
  );
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
 * ever echoes what it was sent. The request URL is never part of it. A failure
 * from the file host (the far side of a download redirect) says so, and passes
 * on none of its words, so nobody goes hunting for a Pipedrive token problem
 * when a signed download link expired.
 */
async function failure(
  status: number,
  res: Response | null,
  token: string,
  onPipedrive: boolean,
): Promise<PipedriveError> {
  const reason = res && onPipedrive ? await readReason(res, token) : null;
  const where = status === 0 ? "no reply" : `HTTP ${status}`;
  const said = reason === null ? "" : ` Pipedrive said: "${reason}"`;
  return new PipedriveError(
    status,
    `${onPipedrive ? PREFIX : FILE_HOST_PREFIX} (${where}): ${plainReason(status, onPipedrive)}.${said}`,
  );
}

/** A redirect that cannot be followed, worded for whichever side sent it. */
function redirectFailure(status: number, onPipedrive: boolean, why: string): PipedriveError {
  return new PipedriveError(status, `${onPipedrive ? PREFIX : FILE_HOST_PREFIX} (HTTP ${status}): ${why}.`);
}

function plainReason(status: number, onPipedrive: boolean): string {
  if (!onPipedrive) {
    if (status === 0) return "could not reach the file host";
    if (status === 403 || status === 404) return "the file host would not give the file (the download link may have expired)";
    return "the file host rejected the request";
  }
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
