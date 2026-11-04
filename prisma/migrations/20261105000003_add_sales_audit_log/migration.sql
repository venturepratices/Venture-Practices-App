-- CreateEnum
CREATE TYPE "SalesActorType" AS ENUM ('USER', 'BOT', 'SYSTEM', 'WEBHOOK');

-- CreateTable
CREATE TABLE "SalesAuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "SalesActorType" NOT NULL,
    "actorId" TEXT,
    "botTokenId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,

    CONSTRAINT "SalesAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesAuditLog_entityType_entityId_at_idx" ON "SalesAuditLog"("entityType", "entityId", "at");

-- Lock the history: rows can be added, never changed, removed or emptied.
CREATE FUNCTION sales_audit_log_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'SalesAuditLog rows cannot be changed or deleted'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_audit_log_no_update_delete BEFORE UPDATE OR DELETE ON "SalesAuditLog"
FOR EACH ROW EXECUTE FUNCTION sales_audit_log_immutable();

CREATE TRIGGER sales_audit_log_no_truncate BEFORE TRUNCATE ON "SalesAuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION sales_audit_log_immutable();
