-- Replace the 3 broad capability flags with ~22 granular per-feature
-- permissions (GHL-style). No data is carried over on purpose — every flag
-- defaults false; an admin explicitly grants each permission per person.

ALTER TABLE "TeamMember" DROP COLUMN "canViewActivityArchive";

ALTER TABLE "TeamMember"
  ADD COLUMN "canCreateClients" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canEditClients" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canDeleteClients" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canCreateTasks" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canEditTasks" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canDeleteTasks" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canCommentOnTasks" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageTaskLinks" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canCreateClientNotes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canEditClientNotes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canDeleteClientNotes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canCreateMeetingNotes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canDeleteMeetingNotes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageClientLinks" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageCredentials" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canRevealCredentials" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageHighLevel" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canViewActivity" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canViewArchive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canRestoreArchive" BOOLEAN NOT NULL DEFAULT false;
