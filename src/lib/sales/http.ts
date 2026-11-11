import { NextResponse } from "next/server";
import type { z } from "zod";

// The small pieces every Sales route handler shares: one shape for a refusal,
// the Origin check that stops another site from making changes with a signed-in
// person's cookie (spec 18.3: SameSite cookies plus an Origin check), and the
// body reader that runs that check first.

export type SalesFail = {
  ok: false;
  /** 413, 415 and 503 are the file upload's: too big, not an allowed type, storage missing or failing. */
  status: 400 | 403 | 404 | 409 | 413 | 415 | 422 | 503;
  error: string;
  /**
   * Set when the screen should react to the refusal, not just show it: the value
   * dialog for Proposal Sent, or the person select in Sales settings when the
   * person who gets every new lead has no Sales access.
   */
  code?: "PROPOSAL_NEEDS_VALUE" | "ASSIGNEE_LOST_ACCESS";
};

const INVALID_INPUT = "Invalid input.";
const REQUEST_BLOCKED = "Request blocked.";

export function fail(status: SalesFail["status"], error: string, code?: SalesFail["code"]): SalesFail {
  return code ? { ok: false, status, error, code } : { ok: false, status, error };
}

/** The JSON response for a refusal: `{ error }`, plus `code` when there is one. */
export function failResponse(f: SalesFail): NextResponse {
  return NextResponse.json(f.code ? { error: f.error, code: f.code } : { error: f.error }, { status: f.status });
}

/**
 * Refuses a request whose `Origin` names another site. No `Origin` passes
 * (scripts and other non-browser clients send none, and SameSite=Lax cookies
 * still cover browsers); an `Origin` of `null` or one that is not a URL does not.
 * The host compared against is the one the browser asked for: `x-forwarded-host`
 * behind a proxy, else `host`.
 */
export function assertSameOrigin(request: Request): SalesFail | null {
  const origin = request.headers.get("origin");
  if (origin === null) return null;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return fail(403, REQUEST_BLOCKED);
  }
  // Host names are case-insensitive; URL already lowercases its side.
  const requestHost = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.toLowerCase();
  return originHost === requestHost ? null : fail(403, REQUEST_BLOCKED);
}

/** A request's search params as `parseBoardQuery`-style input: every value of each key (the parser reads the first). */
export function searchParamsRecord(request: Request): Record<string, string[]> {
  const search = new URL(request.url).searchParams;
  return Object.fromEntries([...new Set(search.keys())].map((key) => [key, search.getAll(key)]));
}

/**
 * Reads and validates a mutating request's JSON body, after the Origin check.
 * Bad JSON is "Invalid input."; a schema failure answers with its first issue's
 * message, so a strictObject's unknown key or a custom message reaches the screen.
 */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | SalesFail> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, INVALID_INPUT);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message || INVALID_INPUT);
  return { ok: true, data: parsed.data };
}
