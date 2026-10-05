-- CreateEnum
CREATE TYPE "IssueKind" AS ENUM ('PROBLEM', 'SITUATION');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'SOLVED');

-- CreateEnum
CREATE TYPE "RockStatus" AS ENUM ('ON_TRACK', 'OFF_TRACK', 'DONE');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ROCK_CHECKIN';

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "canUseLeadership" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "IssueKind" NOT NULL DEFAULT 'PROBLEM',
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "topRank" INTEGER,
    "clientId" TEXT,
    "raisedById" TEXT,
    "convertedTaskId" TEXT,
    "rockId" TEXT,
    "solvedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueRecommendation" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "isDecision" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rock" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "doneDefinition" TEXT,
    "quarter" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "isCompany" BOOLEAN NOT NULL DEFAULT false,
    "status" "RockStatus" NOT NULL DEFAULT 'ON_TRACK',
    "statusUpdatedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Issue_status_idx" ON "Issue"("status");

-- CreateIndex
CREATE INDEX "IssueRecommendation_issueId_idx" ON "IssueRecommendation"("issueId");

-- CreateIndex
CREATE INDEX "Rock_quarter_idx" ON "Rock"("quarter");

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRecommendation" ADD CONSTRAINT "IssueRecommendation_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRecommendation" ADD CONSTRAINT "IssueRecommendation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rock" ADD CONSTRAINT "Rock_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rock" ADD CONSTRAINT "Rock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

