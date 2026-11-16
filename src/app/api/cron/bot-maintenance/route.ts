import { NextResponse } from "next/server";

import { runBotMaintenance } from "@/lib/sales/bot-maintenance";
import { checkBearer } from "@/lib/secret-compare";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily: trims the bot call log to 90 days and warns admins in the app about
 * bot keys that expire within 7 days. Triggered by the Vercel Cron job in
 * vercel.json, authenticated by CRON_SECRET like the other cron routes.
 */
export async function GET(request: Request) {
  if (!checkBearer(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runBotMaintenance()) });
  } catch (error) {
    console.error("Bot maintenance failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ ok: false, error: "Bot maintenance failed" }, { status: 500 });
  }
}
