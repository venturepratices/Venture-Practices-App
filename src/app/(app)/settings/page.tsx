import { notFound } from "next/navigation";

import { loadPermissions } from "@/lib/permissions";
import { getPriorityLevelOptions } from "@/lib/priority-level";
import { getTaskStatusOptions } from "@/lib/task-status";
import { parseNotificationPreferences } from "@/lib/notification-preferences";
import { prisma } from "@/lib/prisma";
import { resolveSlackUserId } from "@/lib/slack";
import { InfoTip } from "@/components/info-tip";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import type { ConnectionsClient, ConnectionsTeamMember } from "@/components/settings/notification-connections-panel";

// Admin-only, app-wide config in one place: Notifications (the same
// self-service form everyone else reaches from the topbar icon, plus the
// admin-only Slack wiring), Task Statuses, and Priority Levels. This is the
// sidebar's "Settings" entry — see AGENCY_LINKS in
// src/components/layout/sidebar.tsx.
export default async function SettingsPage() {
  const perms = await loadPermissions();
  if (!perms?.isAdmin) notFound();

  const me = await prisma.teamMember.findUnique({
    where: { id: perms.userId },
    select: { notificationPreferences: true, slackUserId: true },
  });
  const prefsInitial = parseNotificationPreferences(me?.notificationPreferences ?? null);

  const [members, clients, statusOptions, priorityLevelOptions] = await Promise.all([
    prisma.teamMember.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, slackUserId: true },
    }),
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slackChannelId: true },
    }),
    getTaskStatusOptions(),
    getPriorityLevelOptions(),
  ]);

  // Same live-resolution pass as src/app/(app)/settings/notifications/page.tsx's
  // Connections tab — see that file for the rationale.
  const teamMembers: ConnectionsTeamMember[] = await Promise.all(
    members.map(async (member) => {
      const slackUserId = await resolveSlackUserId(member);
      return { id: member.id, name: member.name, mapped: !!slackUserId };
    })
  );

  const connections = {
    health: {
      botToken: !!process.env.SLACK_BOT_TOKEN,
      internalChannel: !!process.env.SLACK_INTERNAL_CHANNEL_ID,
      appUrl: !!process.env.NEXT_PUBLIC_APP_URL,
    },
    teamMembers,
    clients: clients.map((client) => ({ id: client.id, name: client.name, channelActive: !!client.slackChannelId })) as ConnectionsClient[],
  };

  return (
    <div className="max-w-4xl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Settings
          <InfoTip>
            Notifications, Task Statuses, and Priority Levels — the app-wide config every task and person reads
            from. Task Statuses and Priority Levels apply instantly to every task the moment you rename, recolor,
            reorder, or delete one.
          </InfoTip>
        </h1>
        <p className="mt-1 text-muted-foreground">Everything admin-configurable, in one place.</p>
      </div>

      <div className="mt-6">
        <SettingsTabs
          prefsInitial={prefsInitial}
          slackDestinationInitial={me?.slackUserId ?? null}
          connections={connections}
          statusOptions={statusOptions}
          priorityLevelOptions={priorityLevelOptions}
        />
      </div>
    </div>
  );
}
