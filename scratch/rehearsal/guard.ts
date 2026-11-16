// Rehearsal guard: refuses to run unless DATABASE_URL points at the DEV Neon branch.
// Prints only the host. Removes every token from this process's env so nothing external is reachable.
import "dotenv/config";
const raw = process.env.DATABASE_URL ?? "";
let host = "";
try { host = new URL(raw).hostname; } catch { /* empty */ }
if (!host.startsWith("ep-long-dew-ad8nkrdc")) {
  console.error("GUARD FAIL: database host is not the dev branch. Exiting before connecting.");
  process.exit(1);
}
for (const key of Object.keys(process.env)) {
  if (/^(BLOB_|SLACK_|PIPEDRIVE_|HIGHLEVEL|GHL_|SENTRY_|RESEND|SMTP|GOOGLE_|OPENAI|ANTHROPIC|NITRO)/i.test(key)) delete process.env[key];
}
export const GUARD_HOST = host;
export function assertNoBlob() {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) throw new Error("Blob env present");
}
