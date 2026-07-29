-- Personal Slack DM delivery: manual override + auto-lookup cache for each
-- team member's Slack user id (replaces the shared-channel webhook model).
ALTER TABLE "TeamMember" ADD COLUMN "slackUserId" TEXT;
