import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated health check for external uptime monitoring
 * (UptimeRobot or similar) — deliberately checks real DB connectivity
 * rather than just returning 200, since "the app responds" and "the app can
 * actually read/write data" are different failure modes and only the latter
 * is worth paging someone over. No auth needed: this leaks nothing beyond
 * "the service and its database are reachable," the same information a
 * plain ping to any page would already reveal via its response time.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
