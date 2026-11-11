-- AlterTable
-- A new settings row made without a rotation list used to store NULL, which the raw
-- cursor update in lead assignment reads back as null. Default to an empty list instead.
ALTER TABLE "SalesSettings" ALTER COLUMN "roundRobinMemberIds" SET DEFAULT ARRAY[]::TEXT[];

-- Fix any row that already stored NULL.
UPDATE "SalesSettings" SET "roundRobinMemberIds" = ARRAY[]::TEXT[] WHERE "roundRobinMemberIds" IS NULL;
