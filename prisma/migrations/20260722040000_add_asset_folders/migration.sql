-- Assets tab redesign: folders to segment assets per client.
CREATE TABLE "AssetFolder" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetFolder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssetFolder_clientId_idx" ON "AssetFolder"("clientId");

ALTER TABLE "AssetFolder" ADD CONSTRAINT "AssetFolder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Asset" ADD COLUMN "folderId" TEXT;

CREATE INDEX "Asset_folderId_idx" ON "Asset"("folderId");

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "AssetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
