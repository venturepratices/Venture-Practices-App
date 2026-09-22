-- CreateTable
CREATE TABLE "PrivateProject" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivateProject_ownerId_idx" ON "PrivateProject"("ownerId");

-- AddForeignKey
ALTER TABLE "PrivateProject" ADD CONSTRAINT "PrivateProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "privateProjectId" TEXT;

-- CreateIndex
CREATE INDEX "Task_privateProjectId_idx" ON "Task"("privateProjectId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_privateProjectId_fkey" FOREIGN KEY ("privateProjectId") REFERENCES "PrivateProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
