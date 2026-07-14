-- Bootstrap the permission model on existing accounts (one-time data migration).
--
-- The first/owner account becomes an admin so the team is never locked out of
-- team + permission management.
UPDATE "TeamMember" SET "isAdmin" = true WHERE "email" = 'campaignmanager@venturepractices.com';

-- Every other EXISTING member keeps their current client visibility (they could
-- see all clients before this feature), but sensitive areas (Credentials,
-- Conversations, Activity/Archive) stay locked off by the column defaults until
-- an admin grants them. New members created after this migration get the
-- fully-closed schema defaults (no admin, no clients, no sensitive access).
UPDATE "TeamMember" SET "allClientsAccess" = true WHERE "isAdmin" = false;
