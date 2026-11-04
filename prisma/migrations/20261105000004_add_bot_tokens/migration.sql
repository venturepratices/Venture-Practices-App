-- CreateTable
CREATE TABLE "BotToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "actingForId" TEXT NOT NULL,
    "scopes" TEXT[],
    "pipelineKeys" TEXT[],
    "tokenHash" TEXT NOT NULL,
    "tokenLast4" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "BotToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotTokenUsage" (
    "tokenId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BotTokenUsage_pkey" PRIMARY KEY ("tokenId","kind","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotToken_tokenHash_key" ON "BotToken"("tokenHash");

-- CreateIndex
CREATE INDEX "BotToken_actingForId_idx" ON "BotToken"("actingForId");

-- AddForeignKey
ALTER TABLE "BotToken" ADD CONSTRAINT "BotToken_actingForId_fkey" FOREIGN KEY ("actingForId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotTokenUsage" ADD CONSTRAINT "BotTokenUsage_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "BotToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

