import * as Sentry from "@sentry/nextjs";

// Auto-loaded by Next.js for the browser bundle — same guarded-no-op pattern
// as the server/edge configs. The DSN is intentionally not secret (it ships
// in this client bundle either way), which is why it's a NEXT_PUBLIC_ var.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
