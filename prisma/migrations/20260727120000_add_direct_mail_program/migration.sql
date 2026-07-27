-- Direct Mail Program (Slice 1): per-client program + campaign structure,
-- with Task-attachment columns and view/manage caps on TeamMember.

CREATE TYPE "ProgramStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');

CREATE TYPE "ProgramProduct" AS ENUM ('NEW_MOVERS', 'EDDM', 'INVITATION', 'REACTIVATION', 'RECALL', 'OTHER');

CREATE TYPE "CampaignStage" AS ENUM ('PLANNING', 'CREATIVE', 'REVIEW', 'APPROVAL', 'PRODUCTION', 'MAILED', 'RESULTS');

-- New TeamMember permission columns
ALTER TABLE "TeamMember" ADD COLUMN "canViewDirectMail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamMember" ADD COLUMN "canManageDirectMail" BOOLEAN NOT NULL DEFAULT false;

-- Program
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product" "ProgramProduct" NOT NULL DEFAULT 'NEW_MOVERS',
    "status" "ProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "startMonth" TIMESTAMP(3) NOT NULL,
    "lengthMonths" INTEGER NOT NULL DEFAULT 1,
    "accountManagerId" TEXT,
    "templateSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Program_clientId_idx" ON "Program"("clientId");

ALTER TABLE "Program" ADD CONSTRAINT "Program_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Program" ADD CONSTRAINT "Program_accountManagerId_fkey" FOREIGN KEY ("accountManagerId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Campaign
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "mailDate" TIMESTAMP(3) NOT NULL,
    "creativeDueDate" TIMESTAMP(3) NOT NULL,
    "approvalDueDate" TIMESTAMP(3) NOT NULL,
    "printDueDate" TIMESTAMP(3) NOT NULL,
    "currentStage" "CampaignStage" NOT NULL DEFAULT 'PLANNING',
    "quantity" INTEGER,
    "geography" TEXT,
    "budgetCents" INTEGER,
    "offer" TEXT,
    "cta" TEXT,
    "stagesSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Campaign_programId_idx" ON "Campaign"("programId");
CREATE UNIQUE INDEX "Campaign_programId_sequenceNumber_key" ON "Campaign"("programId", "sequenceNumber");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Task extensions
ALTER TABLE "Task" ADD COLUMN "programId" TEXT;
ALTER TABLE "Task" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "Task" ADD COLUMN "campaignStage" "CampaignStage";
ALTER TABLE "Task" ADD COLUMN "templateTaskId" TEXT;

CREATE INDEX "Task_programId_idx" ON "Task"("programId");
CREATE INDEX "Task_campaignId_campaignStage_idx" ON "Task"("campaignId", "campaignStage");

ALTER TABLE "Task" ADD CONSTRAINT "Task_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
