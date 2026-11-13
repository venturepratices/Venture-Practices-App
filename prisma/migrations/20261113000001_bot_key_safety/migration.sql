-- Additive only: new columns with defaults or NULL, one new table, one new enum value.
-- Nothing is dropped or rewritten. Hand-written; not run here.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOT_ALERT';

-- AlterTable
ALTER TABLE "BotToken" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "allPipelines" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ownDealsOnly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "mustRotate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastUsedIp" TEXT,
ADD COLUMN "knownIps" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "offReason" TEXT,
ADD COLUMN "offAt" TIMESTAMP(3),
ADD COLUMN "expiryWarnedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BotCallLog" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "scope" TEXT,
    "status" INTEGER NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "BotCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotCallLog_tokenId_at_idx" ON "BotCallLog"("tokenId", "at");

-- CreateIndex
CREATE INDEX "BotCallLog_at_idx" ON "BotCallLog"("at");

-- AddForeignKey
ALTER TABLE "BotCallLog" ADD CONSTRAINT "BotCallLog_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "BotToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
