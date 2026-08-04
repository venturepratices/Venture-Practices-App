-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "ActivityLog_clientId_idx" ON "ActivityLog"("clientId");

-- RenameIndex
ALTER INDEX "WorkflowTaskTemplateAssignee_workflowTaskTemplateId_teamMe_key" RENAME TO "WorkflowTaskTemplateAssignee_workflowTaskTemplateId_teamMem_key";
