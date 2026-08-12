-- Task detail popup: a lightweight checklist of subtasks inside a Task.
CREATE TABLE "TaskSubtask" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "sequenceNumber" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TaskSubtask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskSubtask_taskId_idx" ON "TaskSubtask"("taskId");

ALTER TABLE "TaskSubtask" ADD CONSTRAINT "TaskSubtask_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Frozen JSON snapshot at archive time, same pattern as ArchivedTask.links.
ALTER TABLE "ArchivedTask" ADD COLUMN "subtasks" JSONB;
