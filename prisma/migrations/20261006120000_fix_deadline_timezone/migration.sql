-- A deadline picked from a date input used to be stored at UTC midnight for
-- that calendar date (`new Date("2026-10-12").toISOString()`), but every
-- display formats dates in America/New_York — so 2026-10-12T00:00:00Z showed
-- as 10/11/2026, a day early, and the overdue check fired at 8pm the evening
-- BEFORE the task was actually due.
--
-- A deadline now means "the end of that calendar day in the app's timezone"
-- (see deadlineFromDateInput in src/lib/utils.ts). This moves existing rows
-- onto that convention.
--
-- Matching on exact UTC midnight is what makes this safe: the date picker was
-- the only thing that ever produced that value. Deadlines computed as real
-- instants (a recurring task's next occurrence) carry a real time of day, so
-- they don't match and are left untouched. Re-running is a no-op for the same
-- reason — converted rows no longer sit at midnight.
UPDATE "Task"
SET "deadline" = (("deadline"::date + time '23:59:59.999') AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC'
WHERE "deadline" IS NOT NULL
  AND "deadline" = date_trunc('day', "deadline");

UPDATE "ArchivedTask"
SET "deadline" = (("deadline"::date + time '23:59:59.999') AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC'
WHERE "deadline" IS NOT NULL
  AND "deadline" = date_trunc('day', "deadline");
