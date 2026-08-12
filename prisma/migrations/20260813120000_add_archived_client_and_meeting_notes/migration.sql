-- Adds soft-delete/archive support for ClientNote and MeetingNote, mirroring
-- the existing ArchivedTask/ArchivedCampaign/ArchivedWorkflowInstance pattern.
-- Deleting a note now snapshots it here before removing the live row, instead
-- of a plain irrecoverable hard delete.

CREATE TABLE "ArchivedClientNote" (
    "id" TEXT NOT NULL,
    "originalNoteId" TEXT NOT NULL,
    "clientId" TEXT,
    "clientName" TEXT,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "noteCreatedAt" TIMESTAMP(3) NOT NULL,
    "noteUpdatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedById" TEXT,

    CONSTRAINT "ArchivedClientNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArchivedClientNote_originalNoteId_idx" ON "ArchivedClientNote"("originalNoteId");
CREATE INDEX "ArchivedClientNote_clientId_idx" ON "ArchivedClientNote"("clientId");

ALTER TABLE "ArchivedClientNote" ADD CONSTRAINT "ArchivedClientNote_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ArchivedMeetingNote" (
    "id" TEXT NOT NULL,
    "originalNoteId" TEXT NOT NULL,
    "clientId" TEXT,
    "clientName" TEXT,
    "authorName" TEXT,
    "title" TEXT NOT NULL,
    "meetingDate" TIMESTAMP(3) NOT NULL,
    "transcript" TEXT NOT NULL,
    "summary" TEXT,
    "source" "MeetingNoteSource" NOT NULL,
    "noteCreatedAt" TIMESTAMP(3) NOT NULL,
    "noteUpdatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedById" TEXT,

    CONSTRAINT "ArchivedMeetingNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArchivedMeetingNote_originalNoteId_idx" ON "ArchivedMeetingNote"("originalNoteId");
CREATE INDEX "ArchivedMeetingNote_clientId_idx" ON "ArchivedMeetingNote"("clientId");

ALTER TABLE "ArchivedMeetingNote" ADD CONSTRAINT "ArchivedMeetingNote_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
