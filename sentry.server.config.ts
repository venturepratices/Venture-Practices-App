import * as Sentry from "@sentry/nextjs";

import { sentryScrubHooks } from "./src/lib/sentry-scrub";

// Sentry DSNs aren't secrets (they're embedded in the client bundle too), so
// one NEXT_PUBLIC_ var covers server, edge, and client config — see
// .env.example. `enabled: false` when unset means this is a true no-op, not
// a throw, matching this app's "guarded by env var, warn-and-skip" pattern
// used for every other optional integration (Slack, Blob, HighLevel).
// The scrub hooks keep keys, tokens, query strings, headers, cookies, bodies,
// IPs and emails out of every error, trace and breadcrumb (including the
// route errors instrumentation.ts's onRequestError reports).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  ...sentryScrubHooks,
});
