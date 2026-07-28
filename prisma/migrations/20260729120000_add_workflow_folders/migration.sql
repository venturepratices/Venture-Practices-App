-- Workflow folders: per-client grouping for workflow instances, mirrors AssetFolder exactly.
CREATE TABLE "WorkflowFolder" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowFolder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowFolder_clientId_idx" ON "WorkflowFolder"("clientId");

ALTER TABLE "WorkflowFolder" ADD CONSTRAINT "WorkflowFolder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowInstance" ADD COLUMN "folderId" TEXT;

CREATE INDEX "WorkflowInstance_folderId_idx" ON "WorkflowInstance"("folderId");

ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "WorkflowFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
