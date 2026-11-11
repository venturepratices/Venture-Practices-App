-- Sales Plan 2 (board and deal panel): columns and indexes only, no new tables.

-- How many days an open deal can sit in a stage before its card turns amber.
-- Every stage that is neither won nor lost starts at 14; won and lost stay NULL.
ALTER TABLE "SalesStage" ADD COLUMN "rottingDays" INTEGER;
UPDATE "SalesStage" SET "rottingDays" = 14 WHERE "isWon" = false AND "isLost" = false;

-- Where a deal came from, and the optional comment that goes with a lost reason.
ALTER TABLE "SalesDeal" ADD COLUMN "source" TEXT, ADD COLUMN "lostComment" TEXT;

-- Each person's remembered Deals view ({ pipeline, view, scope }). A preference, not Sales data.
ALTER TABLE "TeamMember" ADD COLUMN "salesDefaultView" JSONB;

-- Board and list queries filter by pipeline and status; activity lists filter by done and due.
CREATE INDEX "SalesDeal_pipelineId_status_updatedAt_idx" ON "SalesDeal"("pipelineId", "status", "updatedAt");
CREATE INDEX "SalesActivity_doneAt_dueAt_idx" ON "SalesActivity"("doneAt", "dueAt");
