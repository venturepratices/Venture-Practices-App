-- Change ClientOrder.clientId and Campaign.clientId from ON DELETE CASCADE to
-- ON DELETE RESTRICT. Deleting a Client used to silently hard-delete every
-- one of its Orders (permanent billing documents, no undo) and Campaigns
-- (Direct Mail history) along with it. The client-delete route now archives
-- campaigns and blocks on existing orders before it ever reaches this
-- constraint — this is a database-level backstop, not the primary guard.

ALTER TABLE "ClientOrder" DROP CONSTRAINT "ClientOrder_clientId_fkey";
ALTER TABLE "ClientOrder" ADD CONSTRAINT "ClientOrder_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_clientId_fkey";
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
