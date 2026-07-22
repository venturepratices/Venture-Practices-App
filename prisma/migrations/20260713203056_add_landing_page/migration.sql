-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'LIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "ClientNote" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "LandingPageStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "ghlPageUrl" TEXT,
    "templateVersion" TEXT,
    "sourcePath" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LandingPage_clientId_idx" ON "LandingPage"("clientId");

-- AddForeignKey
ALTER TABLE "LandingPage" ADD CONSTRAINT "LandingPage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
