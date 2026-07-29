import { NextResponse } from "next/server";

import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

// Prisma + the Neon WebSocket driver require the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMINDER_WINDOW_HOURS = 24;
// Dedupe guard for the due-soon pass: don't remind again if one already went
// out for this task within the last 20 hours — covers the once-daily cron
// cadence with room for a retry, without needing a new column on Task.
// Mirrors src/app/api/cron/asset-due-soon/route.ts.
const DEDUPE_WINDOW_HOURS = 20;

function linkPathFor(task: { id: string; clientId: string | null; workflowInstanceId: string | null }) {
  return task.workflowInstanceId
    ? task.clientId
      ? `/clients/${task.clientId}/workflows/${task.workflowInstanceId}?taskId=${task.id}`
      : `/workflows/${task.workflowInstanceId}?taskId=${task.id}`
    : task.clientId
      ? `/clients/${task.clientId}/tasks?taskId=${task.id}`
      : `/tasks?taskId=${task.id}`;
}

/**
 * Daily due-date reminder for every task app-wide (not just workflow or
 * asset tasks) — triggered by the Vercel Cron job in vercel.json,
 * authenticated by CRON_SECRET like the other cron routes. Posts to Slack
 * (unlike asset-due-soon) per the plan: every notification should reach
 * Slack since there's no other "ping" surface in the app yet.
 *
 * Two independent passes:
 *  - Due-soon: deadline within the next 24h, re-pinged at most once per
 *    ~20h (the daily-cadence dedupe window above).
 *  - Overdue: deadline already passed. One-time ping ever per task — no
 *    daily re-nag, since that would need a per-user frequency preference
 *    to not become noise, and preferences are parked for a future round.
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

  const taskInclude = {
    assignees: { select: { teamMemberId: true, teamMember: { select: { name: true } } } },
  } as const;

  const dueSoonTasks = await prisma.task.findMany({
    where: { deadline: { gte: now, lte: windowEnd }, status: { not: "COMPLETE" } },
    include: taskInclude,
  });

  let dueSoonReminded = 0;
  for (const task of dueSoonTasks) {
    if (task.assignees.length === 0) continue;
    const alreadyReminded = await prisma.notification.findFirst({
      where: { type: "TASK_DUE_SOON", entityId: task.id, createdAt: { gte: dedupeSince } },
      select: { id: true },
    });
    if (alreadyReminded) continue;

    const linkPath = linkPathFor(task);
    await Promise.all(
      task.assignees.map((a) =>
        notify({
          recipientId: a.teamMemberId,
          type: "TASK_DUE_SOON",
          entityType: "Task",
          entityId: task.id,
          entityLabel: task.title,
          message: `${a.teamMember.name} — "${task.title}" is due ${task.deadline!.toLocaleDateString()} and isn't marked complete yet`,
          linkPath,
        })
      )
    );
    dueSoonReminded++;
  }

  const overdueTasks = await prisma.task.findMany({
    where: { deadline: { lt: now }, status: { not: "COMPLETE" } },
    include: taskInclude,
  });

  let overdueReminded = 0;
  for (const task of overdueTasks) {
    if (task.assignees.length === 0) continue;
    const alreadyReminded = await prisma.notification.findFirst({
      where: { type: "TASK_OVERDUE", entityId: task.id },
      select: { id: true },
    });
    if (alreadyReminded) continue;

    const linkPath = linkPathFor(task);
    await Promise.all(
      task.assignees.map((a) =>
        notify({
          recipientId: a.teamMemberId,
          type: "TASK_OVERDUE",
          entityType: "Task",
          entityId: task.id,
          entityLabel: task.title,
          message: `${a.teamMember.name} — "${task.title}" is overdue (was due ${task.deadline!.toLocaleDateString()})`,
          linkPath,
        })
      )
    );
    overdueReminded++;
  }

  return NextResponse.json({
    ok: true,
    dueSoon: { checked: dueSoonTasks.length, reminded: dueSoonReminded },
    overdue: { checked: overdueTasks.length, reminded: overdueReminded },
  });
}
