import * as Sentry from "@sentry/nextjs";

import { sentryScrubHooks } from "./src/lib/sentry-scrub";

// Covers the proxy/middleware runtime — same guarded-no-op pattern and the
// same scrub hooks as sentry.server.config.ts.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  ...sentryScrubHooks,
});
