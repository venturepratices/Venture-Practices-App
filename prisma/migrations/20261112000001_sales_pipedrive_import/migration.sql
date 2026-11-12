-- The one-time Pipedrive import. Additive only: new nullable columns, new unique
-- indexes, two new enums and two new tables. Nothing that exists is changed or removed.
-- SalesDeal.pipedriveId and its unique index already exist (add_sales_tables).

-- CreateEnum
CREATE TYPE "SalesImportMode" AS ENUM ('DRY_RUN', 'LIVE');

-- CreateEnum
CREATE TYPE "SalesImportStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- The Pipedrive id each imported row came from. Null for rows made inside the app.
ALTER TABLE "SalesOrganization" ADD COLUMN     "pipedriveId" INTEGER;
ALTER TABLE "SalesPerson" ADD COLUMN     "pipedriveId" INTEGER;
ALTER TABLE "SalesLead" ADD COLUMN     "pipedriveId" INTEGER;
ALTER TABLE "SalesActivity" ADD COLUMN     "pipedriveId" INTEGER;
ALTER TABLE "SalesNote" ADD COLUMN     "pipedriveId" INTEGER;
ALTER TABLE "SalesFile" ADD COLUMN     "pipedriveId" INTEGER;

-- CreateTable
CREATE TABLE "SalesImportRun" (
    "id" TEXT NOT NULL,
    "mode" "SalesImportMode" NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "status" "SalesImportStatus" NOT NULL,
    "phase" TEXT NOT NULL,
    "cursor" JSONB,
    "counts" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SalesImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesImportUserMap" (
    "pipedriveUserId" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesImportUserMap_pkey" PRIMARY KEY ("pipedriveUserId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrganization_pipedriveId_key" ON "SalesOrganization"("pipedriveId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPerson_pipedriveId_key" ON "SalesPerson"("pipedriveId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesLead_pipedriveId_key" ON "SalesLead"("pipedriveId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesActivity_pipedriveId_key" ON "SalesActivity"("pipedriveId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesNote_pipedriveId_key" ON "SalesNote"("pipedriveId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesFile_pipedriveId_key" ON "SalesFile"("pipedriveId");

-- Only one import can be RUNNING at a time, enforced by the database itself. Every row
-- indexes the same constant, so a second RUNNING row collides with the first. Rows that
-- are DONE or FAILED are left out of the index, so history can hold any number of them.
-- Prisma schema syntax cannot express this index, so it lives only in this migration.
CREATE UNIQUE INDEX "SalesImportRun_one_running" ON "SalesImportRun" ((1)) WHERE "status" = 'RUNNING';
