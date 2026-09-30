-- AlterEnum
ALTER TYPE "TaskOccurrence" ADD VALUE 'RECURRING_BIMONTHLY';
ALTER TYPE "TaskOccurrence" ADD VALUE 'RECURRING_CUSTOM';

-- CreateEnum
CREATE TYPE "RecurrenceUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "customRecurrenceInterval" INTEGER,
ADD COLUMN "customRecurrenceUnit" "RecurrenceUnit";
