import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The one way to check a caller's secret against a secret kept in an env var
 * (CRON_SECRET, AGENT_API_TOKEN, MCP_ACCESS_TOKEN). Never compare those with
 * === or !== (tests/lib/secret-compare-guard.test.ts enforces this):
 *
 * - Both sides are SHA-256 hashed and compared with crypto.timingSafeEqual,
 *   so the time taken does not reveal how much of a guess was right, and
 *   values of different lengths compare safely.
 * - It fails closed: if the configured secret is missing, empty or only
 *   spaces, nothing matches, not even a caller sending "undefined" or "".
 *
 * Short configured secrets are still accepted (refusing them could stop
 * production jobs whose secret we cannot see); keeping them long and random
 * is a settings task.
 */
export function safeEqualSecret(
  presented: string | null | undefined,
  configured: string | null | undefined
): boolean {
  if (typeof configured !== "string" || configured.trim() === "") return false;
  if (typeof presented !== "string") return false;
  return timingSafeEqual(sha256(presented), sha256(configured));
}

/**
 * True when the request carries exactly `Authorization: Bearer <configuredSecret>`
 * (the format Vercel Cron sends). Same rules as safeEqualSecret.
 */
export function checkBearer(request: Request, configuredSecret: string | null | undefined): boolean {
  if (typeof configuredSecret !== "string" || configuredSecret.trim() === "") return false;
  return safeEqualSecret(request.headers.get("authorization"), `Bearer ${configuredSecret}`);
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
