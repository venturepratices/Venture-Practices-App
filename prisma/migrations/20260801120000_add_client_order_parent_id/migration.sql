-- Tracks the exact document a Change Order was created from (distinct from
-- rootOrderId, which points at the line's ultimate origin) so the UI can show
-- "amended from X" and let someone walk the version chain, without relying
-- on a user-facing sequence number that jumps between independent order lines.
ALTER TABLE "ClientOrder" ADD COLUMN "parentOrderId" TEXT;
CREATE INDEX "ClientOrder_parentOrderId_idx" ON "ClientOrder"("parentOrderId");

-- Backfill: every existing CHANGE_ORDER predates the fromOrderId feature and
-- was always created by amending the immediately-preceding document (the one
-- with sequenceNumber - 1) for its client, so that's its real parent.
UPDATE "ClientOrder" co
SET "parentOrderId" = prev."id"
FROM "ClientOrder" prev
WHERE co."clientId" = prev."clientId"
  AND prev."sequenceNumber" = co."sequenceNumber" - 1
  AND co."type" = 'CHANGE_ORDER';
