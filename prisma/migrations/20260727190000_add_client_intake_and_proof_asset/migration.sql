-- Direct Mail Slice 5: client-portal intake (per-Client) + campaign proof-asset link.

CREATE TABLE "ClientIntake" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "targetAudience" TEXT,
    "offerDetails" TEXT,
    "brandGuidelinesUrl" TEXT,
    "additionalNotes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientIntake_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientIntake_clientId_key" ON "ClientIntake"("clientId");

ALTER TABLE "ClientIntake" ADD CONSTRAINT "ClientIntake_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Campaign" ADD COLUMN "proofAssetId" TEXT;

CREATE UNIQUE INDEX "Campaign_proofAssetId_key" ON "Campaign"("proofAssetId");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_proofAssetId_fkey" FOREIGN KEY ("proofAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
