-- Direct Mail Program (Slice 2): multi-assignee refactor + editable template
-- engine (ProgramTemplate/StageTemplate/TaskTemplate) + per-program role
-- bindings.

CREATE TYPE "RoleTag" AS ENUM ('ACCOUNT_MANAGER', 'CREATIVE', 'PRODUCTION', 'CLIENT');

-- TaskAssignee: multi-assignee join, replacing single-assignee Task.assigneeId.
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskAssignee_taskId_teamMemberId_key" ON "TaskAssignee"("taskId", "teamMemberId");
CREATE INDEX "TaskAssignee_teamMemberId_idx" ON "TaskAssignee"("teamMemberId");

ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: every existing single assignee becomes a TaskAssignee row.
-- Task.assigneeId is kept as a deprecated shadow column (not read by app code
-- going forward) rather than dropped, as a one-release safety net.
INSERT INTO "TaskAssignee" ("id", "taskId", "teamMemberId", "createdAt")
SELECT gen_random_uuid()::text, "id", "assigneeId", NOW()
FROM "Task"
WHERE "assigneeId" IS NOT NULL;

-- ProgramTemplate / StageTemplate / TaskTemplate: the editable master that
-- the Campaign Generator wizard (Slice 2) copies from.
CREATE TABLE "ProgramTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product" "ProgramProduct",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramTemplate_name_key" ON "ProgramTemplate"("name");

CREATE TABLE "StageTemplate" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "stage" "CampaignStage" NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,

    CONSTRAINT "StageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StageTemplate_templateId_idx" ON "StageTemplate"("templateId");
CREATE UNIQUE INDEX "StageTemplate_templateId_stage_key" ON "StageTemplate"("templateId", "stage");

ALTER TABLE "StageTemplate" ADD CONSTRAINT "StageTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProgramTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL,
    "stageTemplateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "roleTag" "RoleTag" NOT NULL,
    "daysBeforeMailDate" INTEGER,
    "sequenceNumber" INTEGER NOT NULL,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskTemplate_stageTemplateId_idx" ON "TaskTemplate"("stageTemplateId");

ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_stageTemplateId_fkey" FOREIGN KEY ("stageTemplateId") REFERENCES "StageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ProgramRoleBinding: per-program resolution of a template RoleTag to a real
-- TeamMember, set during the wizard. CLIENT role tag is never bound.
CREATE TABLE "ProgramRoleBinding" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "roleTag" "RoleTag" NOT NULL,
    "teamMemberId" TEXT,

    CONSTRAINT "ProgramRoleBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramRoleBinding_programId_roleTag_key" ON "ProgramRoleBinding"("programId", "roleTag");

ALTER TABLE "ProgramRoleBinding" ADD CONSTRAINT "ProgramRoleBinding_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramRoleBinding" ADD CONSTRAINT "ProgramRoleBinding_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
