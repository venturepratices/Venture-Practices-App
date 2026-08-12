import type { NotificationType } from "@/generated/prisma/client";

/**
 * Every notification type gets exactly one tier, fixed here as the single
 * source of truth (not stored on the DB row — a pure classification, so
 * changing a type's tier later doesn't require a migration or backfill).
 * Tier controls message loudness (emoji/formatting) now, and will control
 * instant-vs-digest delivery once the Ambient digest ships.
 */
export type NotificationTier = "CRITICAL" | "IMPORTANT" | "AMBIENT";

const TIER_BY_TYPE: Record<NotificationType, NotificationTier> = {
  TASK_OVERDUE: "CRITICAL",
  ASSET_CHANGES_REQUESTED: "CRITICAL",
  WORKFLOW_TASK_UP_NEXT: "CRITICAL",

  ASSIGNED: "IMPORTANT",
  MENTIONED: "IMPORTANT",
  STATUS_CHANGED: "IMPORTANT",
  DEADLINE_CHANGED: "IMPORTANT",
  COMMENTED: "IMPORTANT",
  WORKFLOW_STAGE_STARTED: "IMPORTANT",
  WORKFLOW_COMPLETED: "IMPORTANT",
  ASSET_APPROVED: "IMPORTANT",
  ASSET_DECIDED: "IMPORTANT",
  CAMPAIGN_STAGE_ADVANCED: "IMPORTANT",
  CAMPAIGN_TASK_ASSIGNED: "IMPORTANT",
  ORDER_ADDED: "IMPORTANT",
  ORDER_CHANGED: "IMPORTANT",

  ASSET_UPLOADED: "AMBIENT",
  ASSET_COMMENTED: "AMBIENT",
  TASK_DUE_SOON: "AMBIENT",
  ASSET_DUE_SOON: "AMBIENT",
};

export function getNotificationTier(type: NotificationType): NotificationTier {
  return TIER_BY_TYPE[type];
}

/** Every notification type currently classified as Ambient — the set the digest cron batches. */
export function ambientNotificationTypes(): NotificationType[] {
  return (Object.keys(TIER_BY_TYPE) as NotificationType[]).filter((type) => TIER_BY_TYPE[type] === "AMBIENT");
}

export const TIER_EMOJI: Record<NotificationTier, string> = {
  CRITICAL: "🚨",
  IMPORTANT: "🔔",
  AMBIENT: "🔵",
};
