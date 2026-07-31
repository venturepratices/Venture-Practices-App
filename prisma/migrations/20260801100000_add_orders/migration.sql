-- Orders: template-driven Order / Change Order documents per client.
-- OrderTemplate is a single shared, agency-wide row holding admin-defined
-- custom field definitions as JSON. ClientOrder is an immutable, dated
-- document (either the first "Order" or a later "Change Order" amending
-- it) that freezes the template's field definitions + values at creation
-- time, so editing the template later never rewrites old documents.

CREATE TYPE "OrderFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'LONGTEXT');
CREATE TYPE "ClientOrderType" AS ENUM ('ORDER', 'CHANGE_ORDER');
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

ALTER TYPE "NotificationType" ADD VALUE 'ORDER_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_CHANGED';

ALTER TABLE "TeamMember" ADD COLUMN "canViewOrders" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamMember" ADD COLUMN "canManageOrders" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "OrderTemplate" (
  "id" TEXT NOT NULL,
  "customFields" JSONB NOT NULL DEFAULT '[]',
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientOrder" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "type" "ClientOrderType" NOT NULL,
  "sequenceNumber" INTEGER NOT NULL,
  "title" TEXT,
  "services" JSONB NOT NULL,
  "adBudgetCents" INTEGER,
  "notes" TEXT,
  "customFieldValues" JSONB NOT NULL DEFAULT '[]',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientOrder_clientId_sequenceNumber_key" ON "ClientOrder"("clientId", "sequenceNumber");
CREATE INDEX "ClientOrder_clientId_idx" ON "ClientOrder"("clientId");

ALTER TABLE "ClientOrder" ADD CONSTRAINT "ClientOrder_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientOrder" ADD CONSTRAINT "ClientOrder_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
