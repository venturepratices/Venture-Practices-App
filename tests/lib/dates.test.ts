import { describe, expect, it } from "vitest";

import {
  addDaysToDateString,
  addMonthsToDateString,
  dateInputValue,
  daysUntilDue,
  deadlineFromDateInput,
  formatDate,
  normalizeDeadline,
} from "@/lib/utils";

// The bug these lock down: a deadline picked as "2026-10-12" used to be stored
// as 2026-10-12T00:00:00Z, which is 8pm on the 11th in the app's timezone — so
// every list showed the day before, and the task went overdue a day early.

describe("the deadline convention", () => {
  it("stores a picked date as the END of that day in the app's timezone", () => {
    expect(deadlineFromDateInput("2026-10-12").toISOString()).toBe("2026-10-13T03:59:59.999Z");
    // Winter, where the offset is UTC-5 rather than UTC-4.
    expect(deadlineFromDateInput("2026-01-15").toISOString()).toBe("2026-01-16T04:59:59.999Z");
  });

  it("displays the day that was actually picked", () => {
    for (const picked of ["2026-10-12", "2026-01-15", "2026-07-04", "2026-12-31", "2026-03-08", "2026-11-01"]) {
      expect(formatDate(deadlineFromDateInput(picked))).toBe(
        new Date(`${picked}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "America/New_York" })
      );
    }
  });

  it("round-trips back into a date input unchanged", () => {
    for (const picked of ["2026-10-12", "2026-01-01", "2026-12-31", "2026-06-30"]) {
      expect(dateInputValue(deadlineFromDateInput(picked))).toBe(picked);
    }
  });

  it("counts a task due today as 0 days out, not -1", () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    expect(daysUntilDue(deadlineFromDateInput(today))).toBe(0);
    expect(daysUntilDue(deadlineFromDateInput(addDaysToDateString(today, 1)))).toBe(1);
    expect(daysUntilDue(deadlineFromDateInput(addDaysToDateString(today, -1)))).toBe(-1);
  });

  it("is not overdue until its own day has ended locally", () => {
    const deadline = deadlineFromDateInput("2026-10-12");
    // 11:59pm on the 12th, local — still not overdue.
    expect(deadline < new Date("2026-10-13T03:59:00.000Z")).toBe(false);
    // One second into the 13th, local — overdue.
    expect(deadline < new Date("2026-10-13T04:00:01.000Z")).toBe(true);
  });

  it("snaps a computed instant onto the same convention", () => {
    // Mid-afternoon local on the 12th: same day, moved to the day's end.
    expect(normalizeDeadline(new Date("2026-10-12T18:30:00Z")).toISOString()).toBe("2026-10-13T03:59:59.999Z");
    // 10pm local on the 12th is the 13th in UTC — the local day is what counts.
    expect(normalizeDeadline(new Date("2026-10-13T02:00:00Z")).toISOString()).toBe("2026-10-13T03:59:59.999Z");
  });
});

describe("calendar math on date strings", () => {
  it("adds days across month and year ends", () => {
    expect(addDaysToDateString("2026-10-12", 7)).toBe("2026-10-19");
    expect(addDaysToDateString("2026-10-29", 7)).toBe("2026-11-05");
    expect(addDaysToDateString("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("adds months, clamping to the end of a shorter month", () => {
    expect(addMonthsToDateString("2026-10-12", 1)).toBe("2026-11-12");
    expect(addMonthsToDateString("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDateString("2028-01-31", 1)).toBe("2028-02-29"); // leap year
    expect(addMonthsToDateString("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("steps a weekly deadline by exactly 7 days even across a DST change", () => {
    // US DST ends Nov 1 2026, so these two weeks have different UTC offsets.
    const before = deadlineFromDateInput("2026-10-29");
    const after = deadlineFromDateInput(addDaysToDateString(dateInputValue(before), 7));
    expect(dateInputValue(after)).toBe("2026-11-05");
    expect(formatDate(after)).toBe("11/5/2026");
  });
});
