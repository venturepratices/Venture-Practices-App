"use client";

import { useState } from "react";
import { Bell, ListTree, Share2 } from "lucide-react";

import type { NotificationPreferences } from "@/lib/notification-preferences";
import { cn } from "@/lib/utils";
import {
  NotificationConnectionsPanel,
  type ConnectionsClient,
  type ConnectionsHealth,
  type ConnectionsTeamMember,
} from "@/components/settings/notification-connections-panel";
import { NotificationPreferencesForm } from "@/components/settings/notification-preferences-form";

type Tab = "prefs" | "types" | "connect";

const TIER_GROUPS: {
  tier: string;
  tone: string;
  items: { label: string; category: string }[];
}[] = [
  {
    tier: "🚨 Drop everything — instant DM",
    tone: "text-destructive",
    items: [
      { label: "Task is overdue", category: "Tasks" },
      { label: "Client asked for changes", category: "Assets" },
      { label: "It's your turn on a project", category: "Projects" },
    ],
  },
  {
    tier: "🔔 Worth knowing now — instant DM",
    tone: "text-status-warning-foreground",
    items: [
      { label: "Assigned / @-mentioned", category: "Tasks" },
      { label: "Status or deadline changed", category: "Tasks" },
      { label: "New comment", category: "Tasks" },
      { label: "Stage started / completed", category: "Projects" },
      { label: "Campaign stage advanced", category: "Direct Mail" },
      { label: "Asset approved / decided", category: "Assets" },
      { label: "Order added / changed", category: "Orders" },
      { label: "Daily briefing", category: "Daily Briefing" },
    ],
  },
  {
    tier: "🔵 Can wait — digest only",
    tone: "text-muted-foreground",
    items: [
      { label: "Asset uploaded / commented", category: "Assets" },
      { label: "Due soon (task or asset)", category: "Tasks / Assets" },
    ],
  },
];

function NotificationTypesReference() {
  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Every notification lands in one of three urgency tiers, automatically — this is reference only, not editable
        here.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {TIER_GROUPS.map((group) => (
          <div key={group.tier} className="overflow-hidden rounded-lg border">
            <div className={cn("border-b bg-muted/50 px-3 py-2 text-xs font-semibold", group.tone)}>{group.tier}</div>
            <div className="divide-y">
              {group.items.map((item) => (
                <div key={item.label} className="px-3 py-2 text-xs">
                  {item.label}
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{item.category}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NotificationSettingsTabs({
  prefsInitial,
  isAdmin,
  connections,
}: {
  prefsInitial: NotificationPreferences;
  isAdmin: boolean;
  connections?: { health: ConnectionsHealth; teamMembers: ConnectionsTeamMember[]; clients: ConnectionsClient[] };
}) {
  const [tab, setTab] = useState<Tab>("prefs");

  const navItems: { id: Tab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { id: "prefs", label: "My Preferences", icon: <Bell className="size-4" /> },
    { id: "types", label: "Notification Types", icon: <ListTree className="size-4" /> },
    { id: "connect", label: "Connections", icon: <Share2 className="size-4" />, adminOnly: true },
  ];

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col md:overflow-visible">
        {navItems
          .filter((item) => !item.adminOnly || isAdmin)
          .map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                tab === item.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              {item.icon}
              {item.label}
              {item.adminOnly ? (
                <span className="ml-auto rounded-full bg-secondary-accent/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-secondary-accent uppercase">
                  Admin
                </span>
              ) : null}
            </button>
          ))}
      </nav>

      <div className="min-w-0 flex-1">
        {tab === "prefs" ? <NotificationPreferencesForm initial={prefsInitial} /> : null}
        {tab === "types" ? <NotificationTypesReference /> : null}
        {tab === "connect" && isAdmin && connections ? (
          <NotificationConnectionsPanel
            health={connections.health}
            teamMembers={connections.teamMembers}
            clients={connections.clients}
          />
        ) : null}
      </div>
    </div>
  );
}
