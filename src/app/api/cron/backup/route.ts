import { NextResponse } from "next/server";

import { backupDateKey, createDatabaseSnapshot, pruneOldBackups, writeBackupToBlob } from "@/lib/backup";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily database backup endpoint, triggered by the Vercel Cron job configured
 * in vercel.json. Vercel automatically sends `Authorization: Bearer <CRON_SECRET>`
 * on cron invocations when CRON_SECRET is set in the project env, so we reject
 * anything without the matching secret — this route must never be publicly
 * runnable (it reads the entire database).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dateKey = backupDateKey(now);

  try {
    const snapshot = await createDatabaseSnapshot(now);
    const { written, pathname } = await writeBackupToBlob(snapshot, dateKey);
    const pruned = await pruneOldBackups(30, now);

    return NextResponse.json({
      ok: true,
      written,
      pathname,
      pruned,
      counts: snapshot.counts,
    });
  } catch (error) {
    console.error("Database backup failed:", error);
    return NextResponse.json({ ok: false, error: "Backup failed" }, { status: 500 });
  }
}
