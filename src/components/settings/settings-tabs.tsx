"use client";

import { useState } from "react";

import type { NotificationPreferences } from "@/lib/notification-preferences";
import { cn } from "@/lib/utils";
import { NotificationSettingsTabs } from "@/components/settings/notification-settings-tabs";
import type { ConnectionsClient, ConnectionsHealth, ConnectionsTeamMember } from "@/components/settings/notification-connections-panel";
import { TaskStatusEditor } from "@/components/settings/task-status-editor";
import { PriorityLevelEditor } from "@/components/settings/priority-level-editor";

type Tab = "notifications" | "statuses" | "priorities";

const TABS: { id: Tab; label: string }[] = [
  { id: "notifications", label: "Notifications" },
  { id: "statuses", label: "Task Statuses" },
  { id: "priorities", label: "Priority Levels" },
];

type StatusOption = { id: string; label: string; tone: string; color: string; sequenceNumber: number; isComplete: boolean };
type PriorityLevelOption = { id: string; label: string; color: string; sequenceNumber: number };

export function SettingsTabs({
  prefsInitial,
  slackDestinationInitial,
  connections,
  statusOptions,
  priorityLevelOptions,
}: {
  prefsInitial: NotificationPreferences;
  slackDestinationInitial: string | null;
  connections: { health: ConnectionsHealth; teamMembers: ConnectionsTeamMember[]; clients: ConnectionsClient[] };
  statusOptions: StatusOption[];
  priorityLevelOptions: PriorityLevelOption[];
}) {
  const [tab, setTab] = useState<Tab>("notifications");

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col md:overflow-visible">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors",
              tab === t.id
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        {tab === "notifications" ? (
          <NotificationSettingsTabs
            prefsInitial={prefsInitial}
            slackDestinationInitial={slackDestinationInitial}
            isAdmin
            connections={connections}
          />
        ) : null}
        {tab === "statuses" ? (
          <div>
            <p className="mb-4 text-sm text-muted-foreground">
              The set of statuses every task in the app can be set to. Renaming, recoloring, or reordering a status
              here applies instantly to every task on it. Deleting a status still in use requires picking a
              replacement first.
            </p>
            <TaskStatusEditor initialOptions={statusOptions} />
          </div>
        ) : null}
        {tab === "priorities" ? (
          <div>
            <p className="mb-4 text-sm text-muted-foreground">
              The priority levels tasks can be set to — independent of status. Deleting one still in use requires
              picking a replacement first.
            </p>
            <PriorityLevelEditor initialOptions={priorityLevelOptions} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
