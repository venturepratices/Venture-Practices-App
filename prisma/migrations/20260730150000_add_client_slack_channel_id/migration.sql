-- Per-client Slack channel for headline-event broadcasts (workflow handoffs,
-- overdue tasks, asset approvals) — auto-created + cached, or manual override.
ALTER TABLE "Client" ADD COLUMN "slackChannelId" TEXT;
