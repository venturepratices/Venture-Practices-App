-- Reference links attached to a Workflow Template's task templates, so
-- attachments (brief docs, style guides, etc.) auto-populate onto every task
-- a workflow instance spawns from that template. Mirrors TaskLink exactly.

CREATE TABLE "WorkflowTaskTemplateLink" (
    "id" TEXT NOT NULL,
    "workflowTaskTemplateId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTaskTemplateLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowTaskTemplateLink_workflowTaskTemplateId_idx" ON "WorkflowTaskTemplateLink"("workflowTaskTemplateId");

ALTER TABLE "WorkflowTaskTemplateLink" ADD CONSTRAINT "WorkflowTaskTemplateLink_workflowTaskTemplateId_fkey" FOREIGN KEY ("workflowTaskTemplateId") REFERENCES "WorkflowTaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
