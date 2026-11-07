import { NextResponse } from "next/server";

import { syncAllConnectedCalendars } from "@/lib/google-calendar";
import { checkBearer } from "@/lib/secret-compare";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily safety-net re-sync of every connected Google Calendar — including
 * members nobody's viewed Team Availability for recently (sync-on-view in
 * src/app/(app)/team/page.tsx only refreshes connections someone actually
 * looked at). Triggered by the Vercel Cron job in vercel.json, authenticated
 * by CRON_SECRET like every other cron route in this app.
 */
export async function GET(request: Request) {
  if (!checkBearer(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncAllConnectedCalendars();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Calendar sync cron failed:", error);
    return NextResponse.json({ ok: false, error: "Sync failed" }, { status: 500 });
  }
}
