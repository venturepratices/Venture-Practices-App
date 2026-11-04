import { NextResponse } from "next/server";

import { applyMissedMeetingRule } from "@/lib/sales/no-show";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily missed-meeting pass for Sales (spec rule 5, Decision 1): a meeting on
 * an open deal not marked done by the end of its day moves the deal to No Show,
 * is marked missed, and gets a reschedule call. See src/lib/sales/no-show.ts.
 * Triggered by the Vercel Cron job in vercel.json at 11:00 UTC (6 or 7 AM
 * Eastern), authenticated by CRON_SECRET like every other cron route. Sales is
 * private, so this sends nothing to Slack or email; the deal's history records
 * what the rule did.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await applyMissedMeetingRule(new Date());
  return NextResponse.json({ ok: true, ...result });
}
