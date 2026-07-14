-- CreateTable
CREATE TABLE "ClientHighLevelConnection" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "webhookSecret" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientHighLevelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ghlMessageId" TEXT NOT NULL,
    "ghlContactId" TEXT NOT NULL,
    "contactName" TEXT,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "ghlTimestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientHighLevelConnection_clientId_key" ON "ClientHighLevelConnection"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_ghlMessageId_key" ON "ConversationMessage"("ghlMessageId");

-- CreateIndex
CREATE INDEX "ConversationMessage_clientId_channel_ghlTimestamp_idx" ON "ConversationMessage"("clientId", "channel", "ghlTimestamp");

-- CreateIndex
CREATE INDEX "ConversationMessage_ghlContactId_idx" ON "ConversationMessage"("ghlContactId");

-- AddForeignKey
ALTER TABLE "ClientHighLevelConnection" ADD CONSTRAINT "ClientHighLevelConnection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
