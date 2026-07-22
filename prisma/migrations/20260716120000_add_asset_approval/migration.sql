-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'VIDEO', 'PDF', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetDecisionValue" AS ENUM ('APPROVED', 'APPROVED_WITH_CHANGES', 'CHANGES_REQUESTED');

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "canCommentOnAssets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canDecideOnAssets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canDeleteAssets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManageAssetReviewers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canShareAssetsExternally" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canUploadAssets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canViewAssets" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVersion" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "blobUrl" TEXT,
    "externalUrl" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetReviewer" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "teamMemberId" TEXT,
    "clientUserId" TEXT,
    "guestEmail" TEXT,
    "guestName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetReviewer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDecision" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "AssetDecisionValue" NOT NULL,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetComment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinX" DOUBLE PRECISION,
    "pinY" DOUBLE PRECISION,
    "timecodeMs" INTEGER,
    "page" INTEGER,
    "parentId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetShareLink" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_clientId_idx" ON "Asset"("clientId");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "AssetVersion_assetId_idx" ON "AssetVersion"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_versionNumber_key" ON "AssetVersion"("assetId", "versionNumber");

-- CreateIndex
CREATE INDEX "AssetReviewer_assetId_idx" ON "AssetReviewer"("assetId");

-- CreateIndex
CREATE INDEX "AssetReviewer_teamMemberId_idx" ON "AssetReviewer"("teamMemberId");

-- CreateIndex
CREATE INDEX "AssetDecision_versionId_idx" ON "AssetDecision"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetDecision_versionId_reviewerId_key" ON "AssetDecision"("versionId", "reviewerId");

-- CreateIndex
CREATE INDEX "AssetComment_versionId_idx" ON "AssetComment"("versionId");

-- CreateIndex
CREATE INDEX "AssetComment_parentId_idx" ON "AssetComment"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetShareLink_token_key" ON "AssetShareLink"("token");

-- CreateIndex
CREATE INDEX "AssetShareLink_assetId_idx" ON "AssetShareLink"("assetId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetReviewer" ADD CONSTRAINT "AssetReviewer_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetReviewer" ADD CONSTRAINT "AssetReviewer_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDecision" ADD CONSTRAINT "AssetDecision_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AssetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDecision" ADD CONSTRAINT "AssetDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "AssetReviewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetComment" ADD CONSTRAINT "AssetComment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AssetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetComment" ADD CONSTRAINT "AssetComment_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "AssetReviewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetComment" ADD CONSTRAINT "AssetComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AssetComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetShareLink" ADD CONSTRAINT "AssetShareLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetShareLink" ADD CONSTRAINT "AssetShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

