-- Pipelines and stages are archived, never hard-deleted, like the other Sales tables.
-- AlterTable
ALTER TABLE "SalesPipeline" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SalesStage" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Where a history change came from. Adding a column is DDL, which the lock
-- triggers on this table (row-level UPDATE/DELETE, statement-level TRUNCATE)
-- do not fire on. Existing rows get NULL; nothing is rewritten.
-- AlterTable
ALTER TABLE "SalesAuditLog" ADD COLUMN "ipAddress" TEXT,
ADD COLUMN "userAgent" TEXT;

-- Lookups by the record a row hangs off. None of these columns had an index
-- that starts with it (the unique pairs on SalesCustomFieldValue start with fieldId).
-- CreateIndex
CREATE INDEX "SalesActivity_leadId_idx" ON "SalesActivity"("leadId");

-- CreateIndex
CREATE INDEX "SalesActivity_personId_idx" ON "SalesActivity"("personId");

-- CreateIndex
CREATE INDEX "SalesNote_dealId_idx" ON "SalesNote"("dealId");

-- CreateIndex
CREATE INDEX "SalesNote_leadId_idx" ON "SalesNote"("leadId");

-- CreateIndex
CREATE INDEX "SalesNote_personId_idx" ON "SalesNote"("personId");

-- CreateIndex
CREATE INDEX "SalesNote_organizationId_idx" ON "SalesNote"("organizationId");

-- CreateIndex
CREATE INDEX "SalesFile_dealId_idx" ON "SalesFile"("dealId");

-- CreateIndex
CREATE INDEX "SalesFile_leadId_idx" ON "SalesFile"("leadId");

-- CreateIndex
CREATE INDEX "SalesCustomFieldValue_dealId_idx" ON "SalesCustomFieldValue"("dealId");

-- CreateIndex
CREATE INDEX "SalesCustomFieldValue_leadId_idx" ON "SalesCustomFieldValue"("leadId");
