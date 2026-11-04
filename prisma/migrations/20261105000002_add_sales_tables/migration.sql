-- CreateEnum
CREATE TYPE "SalesPipelineKind" AS ENUM ('SALES', 'CONSULTING', 'DELIVERY');

-- CreateEnum
CREATE TYPE "SalesLeadStatus" AS ENUM ('OPEN', 'CONVERTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SalesDealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "SalesActivityType" AS ENUM ('CALL', 'MEETING', 'TASK', 'DEADLINE', 'EMAIL', 'LUNCH');

-- CreateEnum
CREATE TYPE "SalesCustomFieldEntity" AS ENUM ('DEAL', 'LEAD');

-- CreateEnum
CREATE TYPE "SalesCustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT');

-- CreateTable
CREATE TABLE "SalesPipeline" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SalesPipelineKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesStage" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "requiresValue" BOOLEAN NOT NULL DEFAULT false,
    "isNoShow" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrganization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "address" TEXT,
    "website" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesPerson" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT,
    "ownerId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLead" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "personId" TEXT,
    "organizationId" TEXT,
    "ownerId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "SalesLeadStatus" NOT NULL DEFAULT 'OPEN',
    "convertedDealId" TEXT,
    "ghlContactId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDeal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "personId" TEXT,
    "organizationId" TEXT,
    "valueCents" INTEGER NOT NULL DEFAULT 0,
    "mrrCents" INTEGER NOT NULL DEFAULT 0,
    "status" "SalesDealStatus" NOT NULL DEFAULT 'OPEN',
    "lostReason" TEXT,
    "stageEnteredAt" TIMESTAMP(3) NOT NULL,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "expectedCloseDate" TIMESTAMP(3),
    "pipedriveId" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesActivity" (
    "id" TEXT NOT NULL,
    "type" "SalesActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "hasTime" BOOLEAN NOT NULL DEFAULT true,
    "doneAt" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "dealId" TEXT,
    "leadId" TEXT,
    "personId" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesNote" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "dealId" TEXT,
    "leadId" TEXT,
    "personId" TEXT,
    "organizationId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesFile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blobPathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "dealId" TEXT,
    "leadId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesCustomField" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "entity" "SalesCustomFieldEntity" NOT NULL,
    "fieldType" "SalesCustomFieldType" NOT NULL,
    "options" TEXT[],
    "pipelineKeys" TEXT[],
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesCustomFieldValue" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "dealId" TEXT,
    "leadId" TEXT,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesCustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesPipeline_key_key" ON "SalesPipeline"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SalesStage_pipelineId_key_key" ON "SalesStage"("pipelineId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SalesLead_convertedDealId_key" ON "SalesLead"("convertedDealId");

-- CreateIndex
CREATE INDEX "SalesLead_status_createdAt_idx" ON "SalesLead"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDeal_pipedriveId_key" ON "SalesDeal"("pipedriveId");

-- CreateIndex
CREATE INDEX "SalesDeal_pipelineId_status_stageId_idx" ON "SalesDeal"("pipelineId", "status", "stageId");

-- CreateIndex
CREATE INDEX "SalesDeal_ownerId_status_idx" ON "SalesDeal"("ownerId", "status");

-- CreateIndex
CREATE INDEX "SalesActivity_ownerId_doneAt_dueAt_idx" ON "SalesActivity"("ownerId", "doneAt", "dueAt");

-- CreateIndex
CREATE INDEX "SalesActivity_dealId_doneAt_idx" ON "SalesActivity"("dealId", "doneAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesCustomField_key_key" ON "SalesCustomField"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SalesCustomFieldValue_fieldId_dealId_key" ON "SalesCustomFieldValue"("fieldId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesCustomFieldValue_fieldId_leadId_key" ON "SalesCustomFieldValue"("fieldId", "leadId");

-- AddForeignKey
ALTER TABLE "SalesStage" ADD CONSTRAINT "SalesStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "SalesPipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrganization" ADD CONSTRAINT "SalesOrganization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPerson" ADD CONSTRAINT "SalesPerson_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "SalesOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPerson" ADD CONSTRAINT "SalesPerson_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "SalesPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "SalesOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_convertedDealId_fkey" FOREIGN KEY ("convertedDealId") REFERENCES "SalesDeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDeal" ADD CONSTRAINT "SalesDeal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "SalesPipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDeal" ADD CONSTRAINT "SalesDeal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "SalesStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDeal" ADD CONSTRAINT "SalesDeal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDeal" ADD CONSTRAINT "SalesDeal_personId_fkey" FOREIGN KEY ("personId") REFERENCES "SalesPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDeal" ADD CONSTRAINT "SalesDeal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "SalesOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "SalesDeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "SalesPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesNote" ADD CONSTRAINT "SalesNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesNote" ADD CONSTRAINT "SalesNote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "SalesDeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesNote" ADD CONSTRAINT "SalesNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesNote" ADD CONSTRAINT "SalesNote_personId_fkey" FOREIGN KEY ("personId") REFERENCES "SalesPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesNote" ADD CONSTRAINT "SalesNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "SalesOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesFile" ADD CONSTRAINT "SalesFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesFile" ADD CONSTRAINT "SalesFile_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "SalesDeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesFile" ADD CONSTRAINT "SalesFile_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCustomFieldValue" ADD CONSTRAINT "SalesCustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "SalesCustomField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCustomFieldValue" ADD CONSTRAINT "SalesCustomFieldValue_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "SalesDeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCustomFieldValue" ADD CONSTRAINT "SalesCustomFieldValue_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

