import { NextResponse } from "next/server";

import { backupDateKey, createDatabaseSnapshot, pruneOldBackups, writeBackupToBlob } from "@/lib/backup";
import { reportCronFailure } from "@/lib/cron-failure";
import { checkBearer } from "@/lib/secret-compare";

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
  if (!checkBearer(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dateKey = backupDateKey(now);

  try {
    const snapshot = await createDatabaseSnapshot(now);
    const { written, pathname } = await writeBackupToBlob(snapshot, dateKey);
    if (!written) {
      // No storage credentials: nothing was saved, so this must not look like a good backup.
      // Pruning is skipped too, so old backups are never deleted while no new one is being made.
      await reportCronFailure("backup", new Error("Backup was not written (storage credentials missing?)"));
      return NextResponse.json({ ok: false, error: "Backup not written" }, { status: 500 });
    }
    const pruned = await pruneOldBackups(365, now);

    return NextResponse.json({
      ok: true,
      written,
      pathname,
      pruned,
      counts: snapshot.counts,
    });
  } catch (error) {
    console.error("Database backup failed:", error);
    await reportCronFailure("backup", error);
    return NextResponse.json({ ok: false, error: "Backup failed" }, { status: 500 });
  }
}
