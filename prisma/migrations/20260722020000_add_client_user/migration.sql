-- Real client-login accounts (Slice 4b) — separate table from TeamMember.
ALTER TABLE "TeamMember" ADD COLUMN "canManageClientUsers" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ClientUser" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientUser_email_key" ON "ClientUser"("email");
CREATE INDEX "ClientUser_clientId_idx" ON "ClientUser"("clientId");

ALTER TABLE "ClientUser" ADD CONSTRAINT "ClientUser_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AssetReviewer.clientUserId already exists as a plain column (reserved since
-- the Slice 1 migration) — add the foreign key now that ClientUser exists.
ALTER TABLE "AssetReviewer" ADD CONSTRAINT "AssetReviewer_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "ClientUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
