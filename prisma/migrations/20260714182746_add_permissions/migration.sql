-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "allClientsAccess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canViewActivityArchive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canViewConversations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canViewCredentials" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClientAccess" (
    "id" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "ClientAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientAccess_teamMemberId_idx" ON "ClientAccess"("teamMemberId");

-- CreateIndex
CREATE INDEX "ClientAccess_clientId_idx" ON "ClientAccess"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccess_teamMemberId_clientId_key" ON "ClientAccess"("teamMemberId", "clientId");

-- AddForeignKey
ALTER TABLE "ClientAccess" ADD CONSTRAINT "ClientAccess_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccess" ADD CONSTRAINT "ClientAccess_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
