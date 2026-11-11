import type { Breadcrumb, Event } from "@sentry/nextjs";

/**
 * Strips secrets, tokens and personal details out of everything Sentry is
 * about to send (errors, performance traces and breadcrumbs), in every
 * runtime: sentry.server.config.ts, sentry.edge.config.ts and
 * instrumentation-client.ts all pass `sentryScrubHooks` to Sentry.init.
 *
 * Pure functions with no Sentry runtime import, so they behave the same on
 * the server, the edge and in the browser, and are unit tested on their own.
 *
 * What goes: query strings and fragments, request headers (except the
 * browser name), cookies, request bodies, IP addresses, user emails and
 * names, keys and tokens that live in a URL path, and any path segment that
 * looks like an id, a random token or an email. What stays: the error type,
 * message and stack, route names and patterns, and status codes, so errors
 * still group and read the same.
 */

/** Routes whose URL path itself carries a secret, and how much of it does. */
const SECRET_PATHS: { prefix: string; placeholder: string; rest?: true }[] = [
  { prefix: "/api/mcp/", placeholder: "[token]" },
  { prefix: "/api/review/", placeholder: "[token]" },
  { prefix: "/review/", placeholder: "[token]" },
  // Incoming webhook addresses may carry a shared secret anywhere after this.
  { prefix: "/api/webhooks/", placeholder: "[redacted]", rest: true },
];

/** A Next.js route pattern such as [token] or [...nextauth], or one of our placeholders. */
const ROUTE_PATTERN = /^\[{1,2}(\.{3})?[A-Za-z0-9_]+\]{1,2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_CHARS = /^[A-Za-z0-9_-]{16,}$/;

/**
 * Data keys that are dropped outright: query strings, fragments, headers,
 * cookies, bodies, IP addresses, emails and user names.
 */
const DROP_KEYS = [
  /(^|[._])(query|query_string|fragment|headers?|cookies?|body|ip|ip_address|client_ip|email|username)$/i,
  /(^|[._])(headers?|cookies?)[._]/i,
  /(^|[._])(body[._]data|client[._]address|peer[._]address|user[._]name)$/i,
];
/** Data keys whose value is a URL or a path. */
const URL_KEY = /(^|[._])(url|full|path|target|from|to)$/i;
/** A URL (any scheme) or a path starting with "/", at the start of the text or after a space, quote, "(", "=" or ",". */
const URL_IN_TEXT = /(^|[\s"'(=,])([a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+|\/[^\s"'<>]*)/gi;

/** "[email]" or "[id]" when a path segment looks like an email, an id or a random token. */
function identifyingPlaceholder(segment: string): string | null {
  let value = segment;
  try {
    value = decodeURIComponent(segment);
  } catch {
    // keep the raw segment
  }
  if (value.includes("@")) return "[email]";
  if (UUID.test(value)) return "[id]";
  if (!TOKEN_CHARS.test(value)) return null;
  // Route words in this app are short, lowercase and hyphenated. Ids and
  // tokens are long, or mix in digits or capitals, or run on with no breaks.
  if (value.length >= 32 || /[0-9A-Z]/.test(value) || !/[-_]/.test(value)) return "[id]";
  return null;
}

function scrubPath(path: string): string {
  const lower = path.toLowerCase();
  const rule = SECRET_PATHS.find((r) => lower.startsWith(r.prefix));
  // Index of the first secret segment: "/api/mcp/" splits to ["", "api", "mcp", ""].
  const secretIndex = rule ? rule.prefix.split("/").length - 1 : -1;
  return path
    .split("/")
    .map((segment, i) => {
      if (segment === "" || ROUTE_PATTERN.test(segment)) return segment;
      if (rule && (i === secretIndex || (rule.rest && i > secretIndex))) return rule.placeholder;
      return identifyingPlaceholder(segment) ?? segment;
    })
    .join("/");
}

/**
 * The URL with its query string, fragment and any "user:password@" removed,
 * and secret or identifying path segments replaced by placeholders. Works on
 * absolute URLs and on bare paths.
 */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  const withoutQuery = cut === -1 ? url : url.slice(0, cut);
  const parts = /^([a-z][a-z0-9+.-]*:\/\/)([^/]*)(.*)$/i.exec(withoutQuery);
  if (!parts) return scrubPath(withoutQuery);
  const [, scheme, authority, path] = parts;
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return scheme + host + scrubPath(path);
}

/** Scrubs every URL and path inside free text such as "GET /review/abc?x=1". */
function scrubText(text: string): string {
  return text.replace(URL_IN_TEXT, (_match, before: string, url: string) => before + scrubUrl(url));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * A scrubbed copy of a data bag (span data, breadcrumb data, a context):
 * sensitive keys dropped, URLs and paths in strings scrubbed, plain objects
 * and arrays walked a few levels deep. Anything else (an Error, a class
 * instance) is kept as it is.
 */
function scrubData(value: unknown, key = "", depth = 0): unknown {
  if (typeof value === "string") return URL_KEY.test(key) ? scrubUrl(value) : scrubText(value);
  if (depth >= 5) return value;
  if (Array.isArray(value)) return value.map((item) => scrubData(item, "", depth + 1));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) {
    if (DROP_KEYS.some((pattern) => pattern.test(name))) continue;
    out[name] = scrubData(item, name, depth + 1);
  }
  return out;
}

function scrubRecord<T>(value: T): T {
  return scrubData(value) as T;
}

/** Only the method, the scrubbed URL and the browser name (Sentry shows Browser and OS from it). */
function scrubRequest(request: NonNullable<Event["request"]>): NonNullable<Event["request"]> {
  const out: NonNullable<Event["request"]> = {};
  if (request.method) out.method = request.method;
  if (typeof request.url === "string") out.url = scrubUrl(request.url);
  const userAgent = Object.entries(request.headers ?? {}).find(([name]) => name.toLowerCase() === "user-agent");
  if (userAgent) out.headers = { [userAgent[0]]: userAgent[1] };
  return out;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const out: Breadcrumb = { ...breadcrumb };
  if (typeof out.message === "string") out.message = scrubText(out.message);
  if (out.data) out.data = scrubRecord(out.data);
  return out;
}

/** A scrubbed copy of an error or transaction event. The event passed in is not changed. */
export function scrubEvent<T extends Event>(event: T): T {
  const out: T = { ...event };
  if (out.request) out.request = scrubRequest(out.request);
  if (out.user) {
    if (out.user.id !== undefined) out.user = { id: out.user.id };
    else delete out.user;
  }
  if (typeof out.transaction === "string") out.transaction = scrubText(out.transaction);
  if (out.contexts) out.contexts = scrubRecord(out.contexts);
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map(scrubBreadcrumb);
  if (out.spans) {
    out.spans = out.spans.map((span) => ({
      ...span,
      ...(typeof span.description === "string" ? { description: scrubText(span.description) } : {}),
      ...(span.data ? { data: scrubRecord(span.data) } : {}),
    }));
  }
  return out;
}

/** Spread into every Sentry.init so all runtimes scrub the same way. */
export const sentryScrubHooks = {
  beforeSend: <T extends Event>(event: T): T => scrubEvent(event),
  beforeSendTransaction: <T extends Event>(event: T): T => scrubEvent(event),
  beforeBreadcrumb: (breadcrumb: Breadcrumb): Breadcrumb => scrubBreadcrumb(breadcrumb),
};
