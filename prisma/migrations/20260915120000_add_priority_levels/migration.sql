-- AlterTable
ALTER TABLE "TaskStatusOption" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#71717a';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "priorityLevelId" TEXT;

-- CreateTable
CREATE TABLE "PriorityLevelOption" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriorityLevelOption_pkey" PRIMARY KEY ("id")
);

-- Seed the four default priority levels, using readable ids (same convention
-- as TaskStatusOption's enum-key-style ids) so app code and this migration
-- can both refer to 'URGENT' by name instead of a generated cuid.
INSERT INTO "PriorityLevelOption" ("id", "label", "color", "sequenceNumber", "updatedAt") VALUES
  ('LOW', 'Low', '#64748b', 1, CURRENT_TIMESTAMP),
  ('MEDIUM', 'Medium', '#2563eb', 2, CURRENT_TIMESTAMP),
  ('HIGH', 'High', '#d97706', 3, CURRENT_TIMESTAMP),
  ('URGENT', 'Urgent', '#e11d48', 4, CURRENT_TIMESTAMP);

-- Backfill TaskStatusOption.color from each row's prior `tone`, so every
-- existing status pill renders identically to before this migration (the
-- color picker in Settings takes over from here for any future changes).
UPDATE "TaskStatusOption" SET "color" = CASE "tone"
  WHEN 'success' THEN '#059669'
  WHEN 'warning' THEN '#d97706'
  WHEN 'danger'  THEN '#e11d48'
  WHEN 'neutral' THEN '#71717a'
  WHEN 'blue'    THEN '#2563eb'
  WHEN 'violet'  THEN '#7c3aed'
  WHEN 'teal'    THEN '#0d9488'
  WHEN 'sky'     THEN '#0284c7'
  WHEN 'slate'   THEN '#64748b'
  ELSE '#71717a'
END;

-- Priority was previously a TaskStatusOption (entangling "urgent" with
-- workflow state) — split out into its own field. Every task currently on
-- that status moves to Next-Up and is marked Urgent, then the now-unused
-- "Priority" status row is removed. Confirmed via a live read-only check
-- immediately before this migration was written: exactly 11 tasks were on
-- PRIORITY, and no WorkflowTaskTemplate defaulted to it (the second UPDATE
-- below is a defensive no-op guard in case that's ever no longer true).
UPDATE "Task" SET "statusId" = 'NEXT_UP', "priorityLevelId" = 'URGENT' WHERE "statusId" = 'PRIORITY';
UPDATE "WorkflowTaskTemplate" SET "defaultStatusId" = NULL WHERE "defaultStatusId" = 'PRIORITY';
DELETE FROM "TaskStatusOption" WHERE "id" = 'PRIORITY';

-- CreateIndex
CREATE INDEX "PriorityLevelOption_sequenceNumber_idx" ON "PriorityLevelOption"("sequenceNumber");

-- CreateIndex
CREATE INDEX "Task_priorityLevelId_idx" ON "Task"("priorityLevelId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_priorityLevelId_fkey" FOREIGN KEY ("priorityLevelId") REFERENCES "PriorityLevelOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
