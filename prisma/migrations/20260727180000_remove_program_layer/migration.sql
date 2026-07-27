-- Direct Mail: remove the Program layer entirely. Campaigns now attach
-- directly to Client. Existing Direct Mail data (Programs, Campaigns, and
-- any program/campaign-tagged Tasks) is test/exploration data from building
-- this feature — wiped per explicit decision rather than migrated, since
-- there's no reason to carry forward test rows once the shape they were
-- created under no longer exists.

-- Wipe existing Direct Mail data.
DELETE FROM "Task" WHERE "programId" IS NOT NULL OR "campaignId" IS NOT NULL;
DELETE FROM "Campaign";

-- Task: drop the program-level attachment column (campaignId/campaignStage
-- remain). This also drops the Task_programId_fkey constraint and the
-- Task_programId_idx index, both of which reference this column.
ALTER TABLE "Task" DROP COLUMN "programId";

-- Campaign: replace programId with a direct clientId. Dropping the column
-- also drops Campaign_programId_fkey, Campaign_programId_idx, and the
-- Campaign_programId_sequenceNumber_key unique index.
ALTER TABLE "Campaign" DROP COLUMN "programId";
ALTER TABLE "Campaign" ADD COLUMN "clientId" TEXT NOT NULL;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Campaign_clientId_idx" ON "Campaign"("clientId");
CREATE UNIQUE INDEX "Campaign_clientId_sequenceNumber_key" ON "Campaign"("clientId", "sequenceNumber");

-- ProgramTemplate: drop the now-meaningless product classification (the
-- "product" concept was dropped entirely along with Program).
ALTER TABLE "ProgramTemplate" DROP COLUMN "product";

-- Drop ProgramRoleBinding (references Program) and Program itself.
DROP TABLE "ProgramRoleBinding";
DROP TABLE "Program";

DROP TYPE "ProgramStatus";
DROP TYPE "ProgramProduct";
