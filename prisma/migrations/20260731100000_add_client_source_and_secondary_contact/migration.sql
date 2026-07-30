-- Client.source: free-text "where did this client come from" field.
-- Client.secondaryContact*: an optional second point of contact, alongside
-- the existing primary contactName/contactEmail/contactPhone.
ALTER TABLE "Client" ADD COLUMN "source" TEXT;
ALTER TABLE "Client" ADD COLUMN "secondaryContactName" TEXT;
ALTER TABLE "Client" ADD COLUMN "secondaryContactEmail" TEXT;
ALTER TABLE "Client" ADD COLUMN "secondaryContactPhone" TEXT;
