import { NextResponse } from "next/server";

import { AssetStatus } from "@/generated/prisma/enums";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMINDER_WINDOW_HOURS = 24;
// Dedupe guard: don't remind again if one already went out for this asset
// within the last 20 hours — covers the once-daily cron cadence with room
// for a retry, without needing a new "reminded" column on Asset.
const DEDUPE_WINDOW_HOURS = 20;

/**
 * Daily due-date reminder for assets still awaiting review. Triggered by the
 * Vercel Cron job in vercel.json, authenticated by CRON_SECRET like the
 * other cron routes (backup, highlevel-prune). In-app only (slack: false) —
 * per the plan, Slack posts are reserved for the APPROVED/CHANGES_REQUESTED
 * headline moments, not routine reminders.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000);
  const dedupeSince = new Date(now.getTime() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000);

  const dueSoonAssets = await prisma.asset.findMany({
    where: {
      dueDate: { gte: now, lte: windowEnd },
      status: { notIn: [AssetStatus.APPROVED, AssetStatus.ARCHIVED] },
    },
    include: { reviewers: { select: { teamMemberId: true } } },
  });

  let remindedCount = 0;
  for (const asset of dueSoonAssets) {
    const alreadyReminded = await prisma.notification.findFirst({
      where: { type: "ASSET_DUE_SOON", entityId: asset.id, createdAt: { gte: dedupeSince } },
      select: { id: true },
    });
    if (alreadyReminded) continue;

    const recipients = new Set<string>();
    if (asset.createdById) recipients.add(asset.createdById);
    for (const r of asset.reviewers) {
      if (r.teamMemberId) recipients.add(r.teamMemberId);
    }
    if (recipients.size === 0) continue;

    await Promise.all(
      [...recipients].map((recipientId) =>
        notify({
          recipientId,
          type: "ASSET_DUE_SOON",
          entityType: "Asset",
          entityId: asset.id,
          entityLabel: asset.title,
          message: `"${asset.title}" is due ${asset.dueDate!.toLocaleDateString()} and still needs review`,
          slack: false,
        })
      )
    );
    remindedCount++;
  }

  return NextResponse.json({ ok: true, checked: dueSoonAssets.length, reminded: remindedCount });
}
