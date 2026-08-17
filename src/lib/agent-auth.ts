import { NextResponse } from "next/server";

/**
 * Auth gate for the read-only agent API (src/app/api/agent/v1/**), used by
 * Viktor (or any future external agent) to answer questions about the app's
 * data. Same bearer-token-in-env-var shape as every cron route
 * (src/app/api/cron/**) — one long random secret, checked on every request,
 * no session/login involved since the caller isn't a person.
 *
 * Deliberately its own token (AGENT_API_TOKEN), not CRON_SECRET reused — the
 * cron secret is Vercel's own infrastructure calling itself; this token gets
 * pasted into a third party's product, so it needs to be independently
 * revocable without breaking every scheduled job.
 */
export function requireAgentToken(request: Request): NextResponse | null {
  const secret = process.env.AGENT_API_TOKEN;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
