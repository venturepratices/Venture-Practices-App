-- TaskKind: at-a-glance category (Project / Direct Mail / Task / Other).
CREATE TYPE "TaskKind" AS ENUM ('PROJECT', 'DIRECT_MAIL', 'TASK', 'OTHER');

ALTER TABLE "Task" ADD COLUMN "kind" "TaskKind" NOT NULL DEFAULT 'TASK';

-- Private tasks: visible only to their creator. createdById didn't exist on
-- Task at all before this — needed as the anchor for that visibility rule.
ALTER TABLE "Task" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "createdById" TEXT;

ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Task_createdById_isPrivate_idx" ON "Task"("createdById", "isPrivate");

-- Backfill kind for existing tasks from their real link, so day-one data
-- reads correctly instead of everything defaulting to "Task".
UPDATE "Task" SET "kind" = 'PROJECT' WHERE "workflowInstanceId" IS NOT NULL;
UPDATE "Task" SET "kind" = 'DIRECT_MAIL' WHERE "campaignId" IS NOT NULL;
