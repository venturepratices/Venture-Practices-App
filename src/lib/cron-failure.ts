import * as Sentry from "@sentry/nextjs";

/**
 * Tells Sentry that a cron job failed. Call it inside the catch block of every
 * cron route (tests/lib/cron-error-reporting-guard.test.ts fails if a route
 * with a catch does not), so a failed job is no longer silent. Before this, a
 * failure left only a console.error and a red line in Vercel's cron log.
 *
 * - Tags the event with `cron: <job>` so Sentry alert rules and searches can
 *   pick out a single job (for example the nightly backup).
 * - Waits up to 2 seconds for the event to be sent. A serverless function can
 *   be frozen the moment the response goes out, and an unsent event is lost.
 * - Never throws. It runs inside a catch block, so a Sentry outage must not
 *   replace the route's own 500 answer with a second, unrelated error.
 *
 * Deliberately Sentry only: no Slack, no email, no database. Those are separate
 * pieces. Keeping this file free of them also means the Pipedrive sync cron can
 * call it without reaching any shared channel.
 */
export async function reportCronFailure(job: string, error: unknown): Promise<void> {
  try {
    Sentry.captureException(error, { tags: { cron: job }, level: "error" });
    await Sentry.flush(2000);
  } catch {
    // Swallowed on purpose. Reporting a failure must never cause another one.
  }
}
