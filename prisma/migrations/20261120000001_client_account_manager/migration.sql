-- Account manager on each client
--
-- One optional team member who owns the client day to day (asked for by Ben
-- in the 2026-11-20 meeting). Additive only: a new empty column, so every
-- existing client starts as "not assigned". If the person is removed from the
-- team the client is set back to not assigned, never deleted.

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "accountManagerId" TEXT;

-- CreateIndex
CREATE INDEX "Client_accountManagerId_idx" ON "Client"("accountManagerId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_accountManagerId_fkey" FOREIGN KEY ("accountManagerId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
