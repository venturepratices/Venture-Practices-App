-- Planning tab: per-client parking lot for half-formed ideas, kept separate
-- from real Tasks until one is deliberately converted.
CREATE TYPE "PlanningStatus" AS ENUM ('IDEA', 'STRATEGY', 'CONVERTED', 'ARCHIVED');

CREATE TABLE "PlanningItem" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "PlanningStatus" NOT NULL DEFAULT 'IDEA',
  "createdById" TEXT,
  "convertedTaskId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlanningItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanningItem_clientId_status_idx" ON "PlanningItem"("clientId", "status");

ALTER TABLE "PlanningItem" ADD CONSTRAINT "PlanningItem_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlanningItem" ADD CONSTRAINT "PlanningItem_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New granular permission group, same pattern as canViewWorkflows/canManageWorkflows.
ALTER TABLE "TeamMember" ADD COLUMN "canViewPlanning" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamMember" ADD COLUMN "canManagePlanning" BOOLEAN NOT NULL DEFAULT false;
