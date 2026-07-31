-- Adds a lineage marker so a client can have multiple independent, simultaneously
-- active orders. NULL on the ORDER row that starts a line (that row is its own
-- root); set to the line's root id on every CHANGE_ORDER that amends it.
ALTER TABLE "ClientOrder" ADD COLUMN "rootOrderId" TEXT;
CREATE INDEX "ClientOrder_rootOrderId_idx" ON "ClientOrder"("rootOrderId");

-- Backfill existing data: before this change, every CHANGE_ORDER implicitly
-- amended its client's single ORDER row (there was no way to start a second,
-- independent line). Point every existing CHANGE_ORDER at its client's ORDER
-- row so the pre-existing chain keeps behaving as one lineage.
UPDATE "ClientOrder" co
SET "rootOrderId" = root."id"
FROM "ClientOrder" root
WHERE co."clientId" = root."clientId"
  AND root."type" = 'ORDER'
  AND co."type" = 'CHANGE_ORDER';
