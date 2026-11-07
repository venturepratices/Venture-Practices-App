import * as Sentry from "@sentry/nextjs";

import { sentryScrubHooks } from "./src/lib/sentry-scrub";

// Auto-loaded by Next.js for the browser bundle — same guarded-no-op pattern
// and the same scrub hooks as the server/edge configs. The DSN is
// intentionally not secret (it ships in this client bundle either way),
// which is why it's a NEXT_PUBLIC_ var.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  ...sentryScrubHooks,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
