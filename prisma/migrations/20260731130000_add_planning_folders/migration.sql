-- Planning folders: lightweight per-client organizational grouping for
-- planning ideas, same "detach don't cascade-delete" shape as AssetFolder.
CREATE TABLE "PlanningFolder" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlanningFolder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanningFolder_clientId_idx" ON "PlanningFolder"("clientId");

ALTER TABLE "PlanningFolder" ADD CONSTRAINT "PlanningFolder_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlanningItem" ADD COLUMN "folderId" TEXT;

CREATE INDEX "PlanningItem_folderId_idx" ON "PlanningItem"("folderId");

ALTER TABLE "PlanningItem" ADD CONSTRAINT "PlanningItem_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "PlanningFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
