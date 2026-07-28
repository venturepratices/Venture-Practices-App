-- Adds a free-text description field to Task (previously the only free-text
-- fields were Comment.body and TaskLink.label, neither of which is a task-
-- level description). Also adds it to ArchivedTask (for archive/restore
-- round-tripping) and Direct Mail's TaskTemplate (so its spawned tasks can
-- carry a description too, matching WorkflowTaskTemplate, which already had
-- one). See "Workflow Templates Round 2 + Task.description" in the plan file.

ALTER TABLE "Task" ADD COLUMN "description" TEXT;
ALTER TABLE "ArchivedTask" ADD COLUMN "description" TEXT;
ALTER TABLE "TaskTemplate" ADD COLUMN "description" TEXT;
