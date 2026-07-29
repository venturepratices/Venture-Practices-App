-- Intra-stage "you're up next" FYI notification: a per-task order within its
-- stage (nullable, display/notify-only, never a hard gate on task work).
ALTER TABLE "Task" ADD COLUMN "workflowTaskOrder" INTEGER;

-- New notification type for the intra-stage next-task ping.
ALTER TYPE "NotificationType" ADD VALUE 'WORKFLOW_TASK_UP_NEXT';
