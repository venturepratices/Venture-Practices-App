import { NextResponse } from "next/server";

import { pruneAllConnectedClients } from "@/lib/highlevel";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily safety-net prune of the HighLevel conversation cache across ALL connected
 * clients — including ones nobody has opened recently (whose caches the inline
 * sync-time prune never touched). The real guardrail is the inline prune in
 * syncClientConversations; this is belt-and-suspenders. Triggered by the Vercel
 * Cron job in vercel.json, authenticated by CRON_SECRET like /api/cron/backup.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pruned = await pruneAllConnectedClients();
    const totalPruned = Object.values(pruned).reduce((sum, n) => sum + n, 0);
    return NextResponse.json({ ok: true, totalPruned, pruned });
  } catch (error) {
    console.error("HighLevel prune failed:", error);
    return NextResponse.json({ ok: false, error: "Prune failed" }, { status: 500 });
  }
}
