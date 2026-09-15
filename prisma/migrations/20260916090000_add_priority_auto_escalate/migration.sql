-- AlterTable
-- Nullable, no default — every existing priority level starts with automatic
-- escalation OFF (null) until an admin opts a level in from Settings, so
-- nothing about any task's current priority changes just from this
-- migration running.
ALTER TABLE "PriorityLevelOption" ADD COLUMN     "autoApplyDaysBeforeDue" INTEGER;
