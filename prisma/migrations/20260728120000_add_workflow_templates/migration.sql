-- Workflow Templates: generic, reusable staged-pipeline engine (sibling to
-- the Direct Mail template engine, not a replacement for it). See "Feature:
-- Workflow Templates" in the plan file.

-- New NotificationType values
ALTER TYPE "NotificationType" ADD VALUE 'WORKFLOW_STAGE_STARTED';
ALTER TYPE "NotificationType" ADD VALUE 'WORKFLOW_COMPLETED';

-- New TeamMember capability columns
ALTER TABLE "TeamMember" ADD COLUMN "canViewWorkflows" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamMember" ADD COLUMN "canManageWorkflows" BOOLEAN NOT NULL DEFAULT false;

-- WorkflowInstanceStatus enum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('ACTIVE', 'COMPLETE', 'CANCELLED');

-- WorkflowTemplate
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowTemplate_name_key" ON "WorkflowTemplate"("name");

-- WorkflowStageTemplate
CREATE TABLE "WorkflowStageTemplate" (
    "id" TEXT NOT NULL,
    "workflowTemplateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sequenceNumber" INTEGER NOT NULL,

    CONSTRAINT "WorkflowStageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowStageTemplate_workflowTemplateId_idx" ON "WorkflowStageTemplate"("workflowTemplateId");
CREATE UNIQUE INDEX "WorkflowStageTemplate_workflowTemplateId_sequenceNumber_key" ON "WorkflowStageTemplate"("workflowTemplateId", "sequenceNumber");

ALTER TABLE "WorkflowStageTemplate" ADD CONSTRAINT "WorkflowStageTemplate_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "WorkflowTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WorkflowTaskTemplate
CREATE TABLE "WorkflowTaskTemplate" (
    "id" TEXT NOT NULL,
    "workflowStageTemplateId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "defaultStatus" "TaskStatus" NOT NULL DEFAULT 'NEXT_UP',

    CONSTRAINT "WorkflowTaskTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowTaskTemplate_workflowStageTemplateId_idx" ON "WorkflowTaskTemplate"("workflowStageTemplateId");

ALTER TABLE "WorkflowTaskTemplate" ADD CONSTRAINT "WorkflowTaskTemplate_workflowStageTemplateId_fkey" FOREIGN KEY ("workflowStageTemplateId") REFERENCES "WorkflowStageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WorkflowTaskTemplateAssignee
CREATE TABLE "WorkflowTaskTemplateAssignee" (
    "id" TEXT NOT NULL,
    "workflowTaskTemplateId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,

    CONSTRAINT "WorkflowTaskTemplateAssignee_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowTaskTemplateAssignee_teamMemberId_idx" ON "WorkflowTaskTemplateAssignee"("teamMemberId");
CREATE UNIQUE INDEX "WorkflowTaskTemplateAssignee_workflowTaskTemplateId_teamMe_key" ON "WorkflowTaskTemplateAssignee"("workflowTaskTemplateId", "teamMemberId");

ALTER TABLE "WorkflowTaskTemplateAssignee" ADD CONSTRAINT "WorkflowTaskTemplateAssignee_workflowTaskTemplateId_fkey" FOREIGN KEY ("workflowTaskTemplateId") REFERENCES "WorkflowTaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowTaskTemplateAssignee" ADD CONSTRAINT "WorkflowTaskTemplateAssignee_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WorkflowInstance
CREATE TABLE "WorkflowInstance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workflowTemplateId" TEXT,
    "clientId" TEXT,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "stagesSnapshot" JSONB NOT NULL,
    "currentStageNumber" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowInstance_clientId_idx" ON "WorkflowInstance"("clientId");
CREATE INDEX "WorkflowInstance_status_idx" ON "WorkflowInstance"("status");

ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "WorkflowTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Task attachment columns
ALTER TABLE "Task" ADD COLUMN "workflowInstanceId" TEXT;
ALTER TABLE "Task" ADD COLUMN "workflowStageNumber" INTEGER;
ALTER TABLE "Task" ADD COLUMN "workflowTaskTemplateId" TEXT;

CREATE INDEX "Task_workflowInstanceId_workflowStageNumber_idx" ON "Task"("workflowInstanceId", "workflowStageNumber");

ALTER TABLE "Task" ADD CONSTRAINT "Task_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
