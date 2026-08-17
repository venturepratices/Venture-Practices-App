-- Folders for the Project Templates library (Settings → Project Templates).
-- Agency-wide (no clientId) — templates aren't client-scoped, so their
-- folders aren't either. WorkflowTemplate.folderId is SetNull so deleting a
-- folder drops its templates back to "All templates" instead of deleting them.

CREATE TABLE "WorkflowTemplateFolder" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "color"     TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTemplateFolder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WorkflowTemplate" ADD COLUMN "folderId" TEXT;

CREATE INDEX "WorkflowTemplate_folderId_idx" ON "WorkflowTemplate" ("folderId");

ALTER TABLE "WorkflowTemplate" ADD CONSTRAINT "WorkflowTemplate_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "WorkflowTemplateFolder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
