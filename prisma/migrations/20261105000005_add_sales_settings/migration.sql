-- CreateEnum
CREATE TYPE "SalesLeadAssignMode" AS ENUM ('ROUND_ROBIN', 'SINGLE');

-- CreateTable
CREATE TABLE "SalesSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "leadAssignMode" "SalesLeadAssignMode" NOT NULL DEFAULT 'ROUND_ROBIN',
    "roundRobinMemberIds" TEXT[],
    "singleAssigneeId" TEXT,
    "rrCursor" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesSettings_pkey" PRIMARY KEY ("id")
);
