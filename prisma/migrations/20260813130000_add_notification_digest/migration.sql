-- Ambient-tier notifications (ASSET_UPLOADED, ASSET_COMMENTED, TASK_DUE_SOON,
-- ASSET_DUE_SOON) skip the instant Slack DM and get batched into a periodic
-- digest instead (src/app/api/cron/notification-digest/route.ts). This
-- column marks when a row was folded into a digest post, so the cron can
-- select exactly the not-yet-sent ones and never double-send.
ALTER TABLE "Notification" ADD COLUMN "digestedAt" TIMESTAMP(3);

CREATE INDEX "Notification_type_digestedAt_idx" ON "Notification"("type", "digestedAt");
