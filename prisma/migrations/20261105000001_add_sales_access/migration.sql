-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "canUseSales" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salesSeesAllDeals" BOOLEAN NOT NULL DEFAULT true;
