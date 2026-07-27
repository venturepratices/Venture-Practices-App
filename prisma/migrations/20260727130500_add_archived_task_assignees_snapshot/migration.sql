-- Full multi-assignee snapshot on ArchivedTask, alongside the legacy
-- single-assignee assigneeId/assigneeName fields (kept for old rows).
ALTER TABLE "ArchivedTask" ADD COLUMN "assignees" JSONB;
