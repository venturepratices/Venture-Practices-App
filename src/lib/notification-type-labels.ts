import type { NotificationType } from "@/generated/prisma/client";

/**
 * The one human-readable name for each notification type — shown in the
 * in-app filter dropdown AND, as of the Slack card redesign, as the small
 * "what kind of notification is this" tag at the top of every Slack card.
 * Single source of truth so the two surfaces can never drift apart.
 */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  ASSIGNED: "Assigned to you",
  MENTIONED: "Mentioned you",
  STATUS_CHANGED: "Status changed",
  DEADLINE_CHANGED: "Deadline changed",
  COMMENTED: "New comment",
  ASSET_UPLOADED: "Asset uploaded",
  ASSET_COMMENTED: "Asset commented",
  ASSET_DECIDED: "Asset decision made",
  ASSET_APPROVED: "Asset approved",
  ASSET_CHANGES_REQUESTED: "Asset changes requested",
  ASSET_DUE_SOON: "Asset due soon",
  CAMPAIGN_STAGE_ADVANCED: "Campaign stage advanced",
  CAMPAIGN_TASK_ASSIGNED: "New campaign task",
  WORKFLOW_STAGE_STARTED: "Project stage started",
  WORKFLOW_COMPLETED: "Project completed",
  WORKFLOW_TASK_UP_NEXT: "You're up next",
  TASK_DUE_SOON: "Task due soon",
  TASK_OVERDUE: "Task overdue",
  ORDER_ADDED: "Order added",
  ORDER_CHANGED: "Change order added",
  DAILY_BRIEFING: "Daily briefing",
};

/** Friendlier names for the raw `entityType` strings ActivityLog/Notification already use. */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  Task: "Task",
  Asset: "Asset",
  Client: "Client",
  Campaign: "Campaign",
  WorkflowInstance: "Project",
  ClientOrder: "Order",
  ClientNote: "Note",
  MeetingNote: "Meeting note",
};

/** Friendly label for a raw `entityType` string — falls back to the string itself for anything unmapped. */
export function entityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}

/**
 * The small top-of-card tag — "Task · Status changed", "Project · You're up
 * next" — so a message never has to be read end-to-end just to learn what
 * it's about. Built entirely from data every notify() call site already
 * passes (entityType + type), so this applies everywhere with no per-call-
 * site changes.
 */
export function buildKicker(entityType: string, type: NotificationType): string {
  return `${entityTypeLabel(entityType)} · ${NOTIFICATION_TYPE_LABELS[type]}`;
}
