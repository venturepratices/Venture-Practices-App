-- Brute-force guard for password-protected asset share links.
ALTER TABLE "AssetShareLink" ADD COLUMN "failedPasswordAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AssetShareLink" ADD COLUMN "lockedUntil" TIMESTAMP(3);
