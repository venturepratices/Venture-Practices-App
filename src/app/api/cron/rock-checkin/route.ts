import { NextResponse } from "next/server";

import { LEADERSHIP_MEMBER_WHERE, quarterKeyFor, quarterLabel, ROCK_STATUS_LABELS } from "@/lib/leadership";
import { notify } from "@/lib/notify";
import { hasRecentNotification } from "@/lib/notify-dedupe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One reminder per owner per week; the window leaves room for a cron retry.
const DEDUPE_WINDOW_HOURS = 72;

/**
 * Monday-morning Rock check-in (vercel.json, before the ~10:30am ET weekly
 * leadership meeting): DMs each Rock owner a list of their unfinished Rocks
 * for the current quarter and asks them to mark each On track / Off track.
 * Owners with nothing open this quarter are skipped silently. Authenticated
 * by CRON_SECRET like the other cron routes.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const quarter = quarterKeyFor();
  const rocks = await prisma.rock.findMany({
    where: { quarter, archivedAt: null, status: { not: "DONE" }, owner: LEADERSHIP_MEMBER_WHERE },
    select: { id: true, title: true, status: true, ownerId: true },
    orderBy: { createdAt: "asc" },
  });

  const byOwner = new Map<string, typeof rocks>();
  for (const rock of rocks) {
    if (!rock.ownerId) continue;
    byOwner.set(rock.ownerId, [...(byOwner.get(rock.ownerId) ?? []), rock]);
  }

  let reminded = 0;
  for (const [ownerId, ownerRocks] of byOwner) {
    // Notification rows are keyed by entityId, so the owner's id stands in
    // as the "entity" for this per-person weekly digest.
    if (await hasRecentNotification("ROCK_CHECKIN", ownerId, DEDUPE_WINDOW_HOURS)) continue;
    await notify({
      recipientId: ownerId,
      type: "ROCK_CHECKIN",
      entityType: "Rock",
      entityId: ownerId,
      entityLabel: `${quarterLabel(quarter)} Rocks`,
      title: `Update your Rocks before today's meeting (${ownerRocks.length})`,
      headline: "Rock check-in",
      subject: "Mark each one On track or Off track before the meeting",
      lines: ownerRocks.map((r) => `${r.title} — last marked ${ROCK_STATUS_LABELS[r.status]}`),
      buttonLabel: "Update my Rocks",
      linkPath: "/rocks",
    });
    reminded++;
  }

  return NextResponse.json({ ok: true, quarter, owners: byOwner.size, reminded });
}
