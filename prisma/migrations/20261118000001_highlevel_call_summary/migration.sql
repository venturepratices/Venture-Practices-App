-- HighLevel Call Summary + Tracking Numbers
--
-- One row per HighLevel conversation per client, holding the latest call
-- metadata (status, tracking number, caller, timestamp). This is the finest
-- granularity we can read without the HL messages endpoint, which HIPAA
-- blocks on client sub-accounts. Powers the Calls view that lets Robert's
-- Muse bot read weekly call numbers through the app rather than through
-- HighLevel's locked API.

CREATE TABLE "HighLevelCallSummary" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ghlConversationId" TEXT NOT NULL,
    "ghlContactId" TEXT NOT NULL,
    "contactName" TEXT,
    "callerPhone" TEXT,
    "trackingNumber" TEXT,
    "direction" TEXT,
    "status" TEXT,
    "lastCallAt" TIMESTAMP(3),
    "lastMessageType" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HighLevelCallSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HighLevelCallSummary_ghlConversationId_key" ON "HighLevelCallSummary"("ghlConversationId");
CREATE INDEX "HighLevelCallSummary_clientId_lastCallAt_idx" ON "HighLevelCallSummary"("clientId", "lastCallAt");
CREATE INDEX "HighLevelCallSummary_clientId_trackingNumber_idx" ON "HighLevelCallSummary"("clientId", "trackingNumber");
CREATE INDEX "HighLevelCallSummary_callerPhone_idx" ON "HighLevelCallSummary"("callerPhone");

ALTER TABLE "HighLevelCallSummary"
  ADD CONSTRAINT "HighLevelCallSummary_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-client mapping of HL tracking phone numbers to campaign names.
CREATE TABLE "HighLevelTrackingNumber" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HighLevelTrackingNumber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HighLevelTrackingNumber_clientId_number_key" ON "HighLevelTrackingNumber"("clientId", "number");
CREATE INDEX "HighLevelTrackingNumber_clientId_idx" ON "HighLevelTrackingNumber"("clientId");

ALTER TABLE "HighLevelTrackingNumber"
  ADD CONSTRAINT "HighLevelTrackingNumber_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
