import * as Sentry from "@sentry/nextjs";

// Sentry DSNs aren't secrets (they're embedded in the client bundle too), so
// one NEXT_PUBLIC_ var covers server, edge, and client config — see
// .env.example. `enabled: false` when unset means this is a true no-op, not
// a throw, matching this app's "guarded by env var, warn-and-skip" pattern
// used for every other optional integration (Slack, Blob, HighLevel).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
