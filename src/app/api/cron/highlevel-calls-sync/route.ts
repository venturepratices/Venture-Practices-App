import { NextResponse } from "next/server";

import { syncCallsForAllConnectedClients } from "@/lib/highlevel";
import { checkBearer } from "@/lib/secret-compare";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily refresh of the HighLevel call details (answered, missed, tracking
 * number, first-time or repeat caller) for EVERY connected client. Until this
 * existed the numbers only refreshed when someone opened a client's tab or
 * pressed Sync now, so the global Calls page and Robert's weekly report could
 * be days stale. Triggered by the Vercel Cron job in vercel.json,
 * authenticated by CRON_SECRET like /api/cron/highlevel-prune.
 */
export async function GET(request: Request) {
  if (!checkBearer(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncCallsForAllConnectedClients();
    if (result.failures.length > 0) {
      console.warn(
        `[highlevel] daily call sync: ${result.failures.length} of ${result.clients} clients failed`
      );
    }
    // Every client failing is a failed run (shows red in Vercel); a partial
    // failure still returns the list so it can be read from the cron log.
    const allFailed = result.clients > 0 && result.synced === 0;
    return NextResponse.json({ ok: !allFailed, ...result }, { status: allFailed ? 502 : 200 });
  } catch (error) {
    console.error("HighLevel daily call sync failed:", error);
    return NextResponse.json({ ok: false, error: "Call sync failed" }, { status: 500 });
  }
}
