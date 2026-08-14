import type { NotificationType, Prisma } from "@/generated/prisma/client";

/**
 * Self-service categorization, one axis away from src/lib/notification-tier.ts's
 * urgency tiers — tier controls HOW a notification is delivered (instant DM
 * vs. digest), category controls WHETHER a person wants it at all. Every
 * NotificationType maps to exactly one category.
 */
export type NotificationCategory = "tasks" | "projects" | "directMail" | "assets" | "orders" | "briefing";

export const CATEGORY_BY_TYPE: Record<NotificationType, NotificationCategory> = {
  ASSIGNED: "tasks",
  MENTIONED: "tasks",
  STATUS_CHANGED: "tasks",
  DEADLINE_CHANGED: "tasks",
  COMMENTED: "tasks",
  TASK_DUE_SOON: "tasks",
  TASK_OVERDUE: "tasks",

  WORKFLOW_STAGE_STARTED: "projects",
  WORKFLOW_COMPLETED: "projects",
  WORKFLOW_TASK_UP_NEXT: "projects",

  CAMPAIGN_STAGE_ADVANCED: "directMail",
  CAMPAIGN_TASK_ASSIGNED: "directMail",

  ASSET_UPLOADED: "assets",
  ASSET_COMMENTED: "assets",
  ASSET_DECIDED: "assets",
  ASSET_APPROVED: "assets",
  ASSET_CHANGES_REQUESTED: "assets",
  ASSET_DUE_SOON: "assets",

  ORDER_ADDED: "orders",
  ORDER_CHANGED: "orders",

  DAILY_BRIEFING: "briefing",
};

export function getNotificationCategory(type: NotificationType): NotificationCategory {
  return CATEGORY_BY_TYPE[type];
}

export const CATEGORY_META: Record<NotificationCategory, { label: string; description: string }> = {
  tasks: {
    label: "Tasks",
    description: "Assignments, @mentions, comments, status & deadline changes, due-soon and overdue reminders.",
  },
  projects: {
    label: "Projects",
    description: "Stage handoffs (\"you're up next\"), project completions.",
  },
  directMail: {
    label: "Direct Mail",
    description: "Campaign stage advances and task assignments.",
  },
  assets: {
    label: "Assets",
    description: "Uploads, comments, approvals, and changes requested.",
  },
  orders: {
    label: "Orders",
    description: "New orders and change orders.",
  },
  briefing: {
    label: "Daily Briefing",
    description: "Your personal cross-client summary, sent weekday mornings.",
  },
};

export const NOTIFICATION_CATEGORIES = Object.keys(CATEGORY_META) as NotificationCategory[];

export type NotificationPreferences = {
  /** Master Slack switch. Off = in-app only, nothing DMs regardless of tier. */
  slackEnabled: boolean;
  /** Categories fully suppressed — no in-app row, no Slack, for every type in it. */
  mutedCategories: NotificationCategory[];
  /** Whether Ambient-tier items (see notification-tier.ts) batch into the periodic Slack digest at all. */
  ambientDigest: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  slackEnabled: true,
  mutedCategories: [],
  ambientDigest: true,
};

function isCategory(value: unknown): value is NotificationCategory {
  return typeof value === "string" && (NOTIFICATION_CATEGORIES as string[]).includes(value);
}

/**
 * Null/malformed input (including every existing TeamMember row, pre-dating
 * this feature) resolves to the defaults — identical to today's behavior, so
 * nobody's notifications change until they actually visit the settings page.
 */
export function parseNotificationPreferences(raw: Prisma.JsonValue | null | undefined): NotificationPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_NOTIFICATION_PREFERENCES;
  const obj = raw as Record<string, unknown>;
  return {
    slackEnabled: typeof obj.slackEnabled === "boolean" ? obj.slackEnabled : DEFAULT_NOTIFICATION_PREFERENCES.slackEnabled,
    mutedCategories: Array.isArray(obj.mutedCategories)
      ? obj.mutedCategories.filter(isCategory)
      : DEFAULT_NOTIFICATION_PREFERENCES.mutedCategories,
    ambientDigest: typeof obj.ambientDigest === "boolean" ? obj.ambientDigest : DEFAULT_NOTIFICATION_PREFERENCES.ambientDigest,
  };
}

export function isCategoryMuted(prefs: NotificationPreferences, type: NotificationType): boolean {
  return prefs.mutedCategories.includes(getNotificationCategory(type));
}
