import { redirect } from "next/navigation";
import { Bell } from "lucide-react";

import { loadPermissions } from "@/lib/permissions";
import { parseNotificationPreferences } from "@/lib/notification-preferences";
import { prisma } from "@/lib/prisma";
import { resolveSlackUserId } from "@/lib/slack";
import { InfoTip } from "@/components/info-tip";
import { NotificationSettingsTabs } from "@/components/settings/notification-settings-tabs";
import type { ConnectionsClient, ConnectionsTeamMember } from "@/components/settings/notification-connections-panel";

export default async function NotificationSettingsPage() {
  const perms = await loadPermissions();
  if (!perms) redirect("/login");

  const me = await prisma.teamMember.findUnique({
    where: { id: perms.userId },
    select: { notificationPreferences: true },
  });
  const prefsInitial = parseNotificationPreferences(me?.notificationPreferences ?? null);

  let connections:
    | {
        health: { botToken: boolean; internalChannel: boolean; appUrl: boolean };
        teamMembers: ConnectionsTeamMember[];
        clients: ConnectionsClient[];
      }
    | undefined;

  if (perms.isAdmin) {
    const [members, clients] = await Promise.all([
      prisma.teamMember.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true, slackUserId: true },
      }),
      prisma.client.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, slackChannelId: true },
      }),
    ]);

    // Attempt a live resolution for anyone not yet mapped, so the status
    // shown here reflects reality right now rather than a stale null — the
    // same lookup that would happen naturally the next time they're notified,
    // just pulled forward so an admin auditing this page sees it live.
    const teamMembers: ConnectionsTeamMember[] = await Promise.all(
      members.map(async (member) => {
        const slackUserId = await resolveSlackUserId(member);
        return { id: member.id, name: member.name, mapped: !!slackUserId };
      })
    );

    connections = {
      health: {
        botToken: !!process.env.SLACK_BOT_TOKEN,
        internalChannel: !!process.env.SLACK_INTERNAL_CHANNEL_ID,
        appUrl: !!process.env.NEXT_PUBLIC_APP_URL,
      },
      teamMembers,
      clients: clients.map((client) => ({ id: client.id, name: client.name, channelActive: !!client.slackChannelId })),
    };
  }

  return (
    <div className="max-w-4xl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Bell className="size-6" />
          Notifications
          <InfoTip>
            Everyone gets &quot;My Preferences&quot; — it only changes what you get notified about. The other tabs
            are admin-only, covering the app-wide Slack wiring.
          </InfoTip>
        </h1>
        <p className="mt-1 text-muted-foreground">This is self-service — nobody else&apos;s notifications are affected.</p>
      </div>

      <div className="mt-6">
        <NotificationSettingsTabs prefsInitial={prefsInitial} isAdmin={perms.isAdmin} connections={connections} />
      </div>
    </div>
  );
}
