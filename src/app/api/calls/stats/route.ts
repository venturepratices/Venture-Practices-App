import { NextResponse } from "next/server";

import { requireUser, toErrorResponse } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCallsStatsForWindow } from "@/lib/highlevel-calls";

/**
 * Read API for the Calls view.
 *
 * Returns the weekly summary + tracking-number breakdown for one or more
 * clients the caller can read. Signed-in users only (admins + sales users);
 * future Muse bot-key access is layered on top in a follow-up (see the
 * paused plan file for the project-wide BotKey design).
 *
 * Query params:
 *   - start: ISO date (default: 7 days ago)
 *   - end:   ISO date (default: now)
 *   - clientIds: comma-separated client ids, or omit for every client the
 *                caller can read
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();

    const url = new URL(request.url);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startRaw = url.searchParams.get("start");
    const endRaw = url.searchParams.get("end");
    const start = startRaw ? new Date(startRaw) : sevenDaysAgo;
    const end = endRaw ? new Date(endRaw) : now;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid start or end date." }, { status: 400 });
    }
    if (end.getTime() <= start.getTime()) {
      return NextResponse.json({ error: "end must be after start." }, { status: 400 });
    }

    const requestedIds = (url.searchParams.get("clientIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Narrow to clients this caller is allowed to read. Admins + all-client
    // access see all; others are restricted by ClientAccess rows (same gate
    // the rest of the app uses).
    let allowed: string[] | undefined;
    if (!user.isAdmin && !user.allClientsAccess) {
      const rows = await prisma.clientAccess.findMany({
        where: { teamMemberId: user.userId },
        select: { clientId: true },
      });
      allowed = rows.map((r) => r.clientId);
      if (allowed.length === 0) {
        return NextResponse.json({ start, end, clientIds: [], stats: emptyStats() });
      }
    }

    const clientIds = requestedIds.length > 0
      ? (allowed ? requestedIds.filter((id) => allowed.includes(id)) : requestedIds)
      : allowed; // undefined for admins = every client

    const stats = await getCallsStatsForWindow({ clientIds, start, end });
    return NextResponse.json({ start, end, clientIds: clientIds ?? "all", stats });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function emptyStats() {
  return {
    totalCalls: 0,
    answered: 0,
    missed: 0,
    firstTimeCallers: 0,
    repeatCallers: 0,
    byTrackingNumber: [],
  };
}
