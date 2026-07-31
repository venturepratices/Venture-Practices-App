-- OrderTemplate becomes a named, listable template (like WorkflowTemplate)
-- instead of a single implicit shared row.
ALTER TABLE "OrderTemplate" ADD COLUMN "name" TEXT;
ALTER TABLE "OrderTemplate" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: the one existing shared row (if any) becomes the first named
-- template, preserving its real custom fields untouched.
UPDATE "OrderTemplate" SET "name" = 'Default' WHERE "name" IS NULL;

ALTER TABLE "OrderTemplate" ALTER COLUMN "name" SET NOT NULL;
CREATE UNIQUE INDEX "OrderTemplate_name_key" ON "OrderTemplate"("name");

-- Records which template (if any) an order was started from — null when
-- started blank, denormalized so it survives the template being renamed
-- or deleted later.
ALTER TABLE "ClientOrder" ADD COLUMN "sourceTemplateName" TEXT;
