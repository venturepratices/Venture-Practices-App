import { NextResponse } from "next/server";

import {
  getClientBriefingData,
  getUserBriefingData,
  isClientBriefingEmpty,
  isUserBriefingEmpty,
} from "@/lib/daily-briefing";
import { notify, notifyChannel } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { todayDateString } from "@/lib/utils";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The morning "executive assistant" digest: one headline + link posted to
 * each client's Slack channel (what's due/overdue/completed/needing a
 * decision on that client), and one DMed to each team member (their own
 * slice across every client) — both linking to a real designed report page
 * (src/app/(app)/clients/[clientId]/briefing and src/app/(app)/my-briefing)
 * rather than trying to render a full page inside Slack itself, which Slack's
 * mrkdwn/Block Kit can't do. Skips anyone/anything with genuinely nothing to
 * report, so an idle client or person doesn't get a daily "nothing happened"
 * ping. Triggered once a day by the Vercel Cron job in vercel.json,
 * authenticated the same CRON_SECRET-bearer way as every other cron route.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateStr = todayDateString();

  const clients = await prisma.client.findMany({
    where: { status: { not: "OFFBOARDED" } },
    select: { id: true, name: true },
  });

  let clientsPosted = 0;
  for (const client of clients) {
    const briefing = await getClientBriefingData(client.id, dateStr);
    if (!briefing || isClientBriefingEmpty(briefing)) continue;

    const lines = [
      briefing.dueToday.length > 0 ? `${briefing.dueToday.length} due today` : null,
      briefing.overdue.length > 0 ? `${briefing.overdue.length} overdue` : null,
      briefing.completedRecently.length > 0 ? `${briefing.completedRecently.length} completed since yesterday` : null,
      briefing.needsDecision.length > 0 ? `${briefing.needsDecision.length} asset${briefing.needsDecision.length === 1 ? "" : "s"} needing a decision` : null,
    ].filter((l): l is string => l !== null);

    await notifyChannel({
      clientId: client.id,
      title: `Daily briefing — ${client.name}`,
      lines,
      linkPath: `/clients/${client.id}/briefing?date=${dateStr}`,
    });
    clientsPosted++;
  }

  const teamMembers = await prisma.teamMember.findMany({ select: { id: true } });

  let peopleNotified = 0;
  for (const member of teamMembers) {
    const briefing = await getUserBriefingData(member.id, dateStr);
    if (isUserBriefingEmpty(briefing)) continue;

    const lines = [
      briefing.dueToday.length > 0 ? `${briefing.dueToday.length} due today` : null,
      briefing.overdue.length > 0 ? `${briefing.overdue.length} overdue` : null,
      briefing.assignedRecently.length > 0 ? `${briefing.assignedRecently.length} newly assigned to you` : null,
      briefing.needsDecision.length > 0 ? `${briefing.needsDecision.length} asset${briefing.needsDecision.length === 1 ? "" : "s"} waiting on your decision` : null,
    ].filter((l): l is string => l !== null);

    await notify({
      recipientId: member.id,
      type: "DAILY_BRIEFING",
      entityType: "TeamMember",
      entityId: member.id,
      entityLabel: "Daily briefing",
      title: "Your daily briefing",
      lines,
      linkPath: `/my-briefing?date=${dateStr}`,
    });
    peopleNotified++;
  }

  return NextResponse.json({
    ok: true,
    date: dateStr,
    clients: { checked: clients.length, posted: clientsPosted },
    people: { checked: teamMembers.length, notified: peopleNotified },
  });
}
