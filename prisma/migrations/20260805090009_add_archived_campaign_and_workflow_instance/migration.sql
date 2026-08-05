-- CreateTable
CREATE TABLE "ArchivedCampaign" (
    "id" TEXT NOT NULL,
    "originalCampaignId" TEXT NOT NULL,
    "clientId" TEXT,
    "clientName" TEXT,
    "name" TEXT,
    "sequenceNumber" INTEGER NOT NULL,
    "mailDate" TIMESTAMP(3),
    "creativeDueDate" TIMESTAMP(3),
    "approvalDueDate" TIMESTAMP(3),
    "printDueDate" TIMESTAMP(3),
    "currentStage" "CampaignStage" NOT NULL,
    "quantity" INTEGER,
    "geography" TEXT,
    "budgetCents" INTEGER,
    "offer" TEXT,
    "cta" TEXT,
    "stagesSnapshot" JSONB,
    "campaignCreatedAt" TIMESTAMP(3) NOT NULL,
    "campaignUpdatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedById" TEXT,

    CONSTRAINT "ArchivedCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchivedWorkflowInstance" (
    "id" TEXT NOT NULL,
    "originalInstanceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT,
    "clientName" TEXT,
    "status" "WorkflowInstanceStatus" NOT NULL,
    "stagesSnapshot" JSONB NOT NULL,
    "currentStageNumber" INTEGER NOT NULL,
    "archivedTaskCount" INTEGER NOT NULL DEFAULT 0,
    "instanceCreatedAt" TIMESTAMP(3) NOT NULL,
    "instanceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "instanceCompletedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedById" TEXT,

    CONSTRAINT "ArchivedWorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchivedCampaign_originalCampaignId_idx" ON "ArchivedCampaign"("originalCampaignId");

-- CreateIndex
CREATE INDEX "ArchivedCampaign_clientId_idx" ON "ArchivedCampaign"("clientId");

-- CreateIndex
CREATE INDEX "ArchivedWorkflowInstance_originalInstanceId_idx" ON "ArchivedWorkflowInstance"("originalInstanceId");

-- CreateIndex
CREATE INDEX "ArchivedWorkflowInstance_clientId_idx" ON "ArchivedWorkflowInstance"("clientId");

-- AddForeignKey
ALTER TABLE "ArchivedCampaign" ADD CONSTRAINT "ArchivedCampaign_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchivedWorkflowInstance" ADD CONSTRAINT "ArchivedWorkflowInstance_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
