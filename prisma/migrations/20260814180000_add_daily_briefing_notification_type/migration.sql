-- Additive enum value for the new daily-briefing digest (client-channel +
-- personal DM summary posted each morning). Safe, non-destructive — existing
-- rows are unaffected.
ALTER TYPE "NotificationType" ADD VALUE 'DAILY_BRIEFING';
