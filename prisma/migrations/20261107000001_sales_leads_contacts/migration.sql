-- Plan 3A: leads, contacts, files and saved views. Columns and indexes only.
ALTER TABLE "SalesPerson" ADD COLUMN "role" TEXT, ADD COLUMN "emailKey" TEXT, ADD COLUMN "phoneKey" TEXT, ADD COLUMN "nameKey" TEXT, ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "SalesOrganization" ADD COLUMN "phone" TEXT, ADD COLUMN "zip" TEXT, ADD COLUMN "nameKey" TEXT, ADD COLUMN "mergedIntoId" TEXT;
-- No SalesFile row exists yet (nothing could upload before this plan), so NOT NULL needs no default.
ALTER TABLE "SalesFile" ADD COLUMN "finalConfirmedAt" TIMESTAMP(3) NOT NULL, ADD COLUMN "stageName" TEXT;
ALTER TABLE "TeamMember" ADD COLUMN "salesSavedViews" JSONB;

-- Duplicate keys for rows that already exist: the same rules as src/lib/sales/contact-keys.ts.
-- After restoring a snapshot taken before this migration, run these two UPDATEs again (Decision 17).
UPDATE "SalesPerson" AS p SET
  "emailKey" = NULLIF(lower(regexp_replace(p."email", '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g')), ''),
  "phoneKey" = CASE WHEN length(k.d) < 7 THEN NULL
                    WHEN length(k.d) >= 11 AND left(k.d, 1) = '1' THEN left(substr(k.d, 2), 10)
                    ELSE left(k.d, 10) END,
  "nameKey" = NULLIF(regexp_replace(lower(p."name"), '[^a-z0-9]', '', 'g'), '')
FROM (SELECT "id", regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') AS d FROM "SalesPerson") AS k
WHERE k."id" = p."id";
UPDATE "SalesOrganization" SET "nameKey" = NULLIF(regexp_replace(lower("name"), '[^a-z0-9]', '', 'g'), '');

CREATE INDEX "SalesPerson_organizationId_idx" ON "SalesPerson"("organizationId");
CREATE INDEX "SalesPerson_ownerId_idx" ON "SalesPerson"("ownerId");
CREATE INDEX "SalesPerson_archivedAt_name_idx" ON "SalesPerson"("archivedAt", "name");
CREATE INDEX "SalesOrganization_archivedAt_name_idx" ON "SalesOrganization"("archivedAt", "name");
CREATE INDEX "SalesPerson_emailKey_idx" ON "SalesPerson"("emailKey");
CREATE INDEX "SalesPerson_phoneKey_idx" ON "SalesPerson"("phoneKey");
CREATE INDEX "SalesPerson_nameKey_idx" ON "SalesPerson"("nameKey");
CREATE INDEX "SalesPerson_mergedIntoId_idx" ON "SalesPerson"("mergedIntoId");
CREATE INDEX "SalesOrganization_ownerId_idx" ON "SalesOrganization"("ownerId");
CREATE INDEX "SalesOrganization_nameKey_idx" ON "SalesOrganization"("nameKey");
CREATE INDEX "SalesOrganization_mergedIntoId_idx" ON "SalesOrganization"("mergedIntoId");
CREATE INDEX "SalesLead_ownerId_status_createdAt_idx" ON "SalesLead"("ownerId", "status", "createdAt");
CREATE INDEX "SalesLead_personId_idx" ON "SalesLead"("personId");
CREATE INDEX "SalesLead_organizationId_idx" ON "SalesLead"("organizationId");
CREATE INDEX "SalesDeal_personId_idx" ON "SalesDeal"("personId");
CREATE INDEX "SalesDeal_organizationId_idx" ON "SalesDeal"("organizationId");
CREATE INDEX "SalesDeal_status_wonAt_idx" ON "SalesDeal"("status", "wonAt");
CREATE INDEX "SalesFile_uploadedById_createdAt_idx" ON "SalesFile"("uploadedById", "createdAt");
CREATE INDEX "SalesAuditLog_entityType_at_idx" ON "SalesAuditLog"("entityType", "at");
