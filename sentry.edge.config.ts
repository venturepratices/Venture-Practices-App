import * as Sentry from "@sentry/nextjs";

// Covers the proxy/middleware runtime — same guarded-no-op pattern as
// sentry.server.config.ts.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
