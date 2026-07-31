import { NextResponse } from "next/server";
import { list } from "@vercel/blob";

import { BACKUP_PREFIX } from "@/lib/backup";
import { notifyChannel } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * Monthly storage/backup health check, triggered by the Vercel Cron job in
 * vercel.json (authenticated by CRON_SECRET like every other cron route).
 * Not a hard limit enforcer — just a standing, automatic reminder posted to
 * Slack every month with real current numbers, so "should we extend backup
 * retention / check storage usage" is a recurring habit baked into the app
 * itself rather than something that depends on anyone remembering to ask.
 * Never blocks anything and never throws past its own try/catch — this is a
 * courtesy notification, not a gate.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [dbSizeResult, blobList, backupList] = await Promise.all([
      prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) as size`,
      list(),
      list({ prefix: BACKUP_PREFIX }),
    ]);

    const dbBytes = Number(dbSizeResult[0]?.size ?? 0);
    const blobBytes = blobList.blobs.reduce((sum, b) => sum + b.size, 0);
    const backupBytes = backupList.blobs.reduce((sum, b) => sum + b.size, 0);
    const oldestBackup = backupList.blobs.reduce<Date | null>((oldest, b) => {
      const uploaded = new Date(b.uploadedAt);
      return !oldest || uploaded < oldest ? uploaded : oldest;
    }, null);

    await notifyChannel({
      message: `Monthly storage check: database ${mb(dbBytes)} MB, backups ${mb(backupBytes)} MB (${backupList.blobs.length} daily snapshots), total Blob storage ${mb(blobBytes)} MB.`,
      slackTitle: "📦 Monthly storage & backup check",
      slackLines: [
        `Database size: ${mb(dbBytes)} MB`,
        `Backup storage: ${mb(backupBytes)} MB across ${backupList.blobs.length} daily snapshots${oldestBackup ? ` (oldest: ${oldestBackup.toISOString().slice(0, 10)})` : ""}`,
        `Total Blob storage (backups + uploaded assets): ${mb(blobBytes)} MB`,
        "Worth a quick look: is retention still long enough, and are we still comfortably under free-tier limits?",
      ],
    });

    return NextResponse.json({
      ok: true,
      databaseMb: mb(dbBytes),
      backupStorageMb: mb(backupBytes),
      totalBlobMb: mb(blobBytes),
      backupCount: backupList.blobs.length,
      oldestBackup: oldestBackup?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("Storage check failed:", error);
    return NextResponse.json({ ok: false, error: "Storage check failed" }, { status: 500 });
  }
}
