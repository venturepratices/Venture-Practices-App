-- Deep-link every notification: an app-relative path to the entity it's about.
ALTER TABLE "Notification" ADD COLUMN "linkPath" TEXT;
