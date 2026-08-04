-- AlterTable
ALTER TABLE "ArchivedTask" ADD COLUMN     "statusLabel" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "statusId" TEXT NOT NULL DEFAULT 'NEXT_UP';

-- AlterTable
ALTER TABLE "WorkflowTaskTemplate" ADD COLUMN     "defaultStatusId" TEXT;

-- CreateTable
CREATE TABLE "TaskStatusOption" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskStatusOption_pkey" PRIMARY KEY ("id")
);

-- Seed the 7 original TaskStatus enum values as real rows, using the enum's
-- own key strings as ids — this is what lets every existing `status: "X"`
-- write site dual-write `statusId: "X"` verbatim (see Task.status comment).
INSERT INTO "TaskStatusOption" ("id", "label", "tone", "sequenceNumber", "isComplete", "updatedAt") VALUES
  ('ACTIVE', 'Active', 'success', 1, false, CURRENT_TIMESTAMP),
  ('IN_PROGRESS', 'In Progress', 'blue', 2, false, CURRENT_TIMESTAMP),
  ('PRIORITY', 'Priority', 'danger', 3, false, CURRENT_TIMESTAMP),
  ('NEXT_UP', 'Next-Up', 'violet', 4, false, CURRENT_TIMESTAMP),
  ('WAITING_ON_CLIENT', 'Waiting on Client', 'warning', 5, false, CURRENT_TIMESTAMP),
  ('ON_HOLD', 'On Hold', 'neutral', 6, false, CURRENT_TIMESTAMP),
  ('COMPLETE', 'Complete', 'teal', 7, true, CURRENT_TIMESTAMP);

-- Backfill Task.statusId from the old enum column now that seed rows exist
-- (the ADD COLUMN default above only covers NEW rows going forward with no
-- explicit status; existing rows need their real prior status carried over).
UPDATE "Task" SET "statusId" = "status"::text;

-- Backfill WorkflowTaskTemplate.defaultStatusId from the old enum column.
UPDATE "WorkflowTaskTemplate" SET "defaultStatusId" = "defaultStatus"::text;

-- Backfill ArchivedTask.statusLabel (denormalized label text, frozen at
-- archive time — not a live FK) from the old enum column's matching label.
UPDATE "ArchivedTask" SET "statusLabel" = CASE "status"::text
  WHEN 'ACTIVE' THEN 'Active'
  WHEN 'IN_PROGRESS' THEN 'In Progress'
  WHEN 'PRIORITY' THEN 'Priority'
  WHEN 'NEXT_UP' THEN 'Next-Up'
  WHEN 'WAITING_ON_CLIENT' THEN 'Waiting on Client'
  WHEN 'ON_HOLD' THEN 'On Hold'
  WHEN 'COMPLETE' THEN 'Complete'
  ELSE "status"::text
END;

-- CreateIndex
CREATE INDEX "TaskStatusOption_sequenceNumber_idx" ON "TaskStatusOption"("sequenceNumber");

-- CreateIndex
CREATE INDEX "Task_statusId_idx" ON "Task"("statusId");

-- CreateIndex
CREATE INDEX "WorkflowTaskTemplate_defaultStatusId_idx" ON "WorkflowTaskTemplate"("defaultStatusId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TaskStatusOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTaskTemplate" ADD CONSTRAINT "WorkflowTaskTemplate_defaultStatusId_fkey" FOREIGN KEY ("defaultStatusId") REFERENCES "TaskStatusOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
