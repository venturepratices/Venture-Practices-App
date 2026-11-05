import { describe, expect, it } from "vitest";
import { endOfDay, zonedDateTime } from "@/lib/utils";
import {
  activityDueAt,
  avatarTone,
  clockTime,
  dayLabel,
  daysInStage,
  dueLabel,
  formatMoney,
  isRotting,
  isValidDateString,
  nextStepPill,
  parseMoneyToCents,
  shortName,
} from "@/lib/sales/format";

// 2026-11-06T04:30:00Z is Nov 5, 11:30 PM Eastern: already "tomorrow" in UTC,
// still "today" for the team.
const lateNov5 = new Date("2026-11-06T04:30:00Z");

describe("parseMoneyToCents", () => {
  it.each([
    ["14400", 1440000],
    ["$14,400", 1440000],
    ["14,400.5", 1440050],
    ["1200.50", 120050],
    [" 0 ", 0],
    ["", 0],
    ["10000000", 1_000_000_000],
  ])("parseMoneyToCents(%j) = %d", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it.each(["-5", "12.345", "1e6", "abc", "10000000.01", "$20,000,000"])("parseMoneyToCents(%j) is null", (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });

  it("never drifts by a cent from floating point", () => {
    expect(parseMoneyToCents("0.29")).toBe(29);
    expect(parseMoneyToCents("1.15")).toBe(115);
    expect(parseMoneyToCents("19.99")).toBe(1999);
  });

  it("refuses commas that are not thousands separators instead of guessing", () => {
    expect(parseMoneyToCents("14,4")).toBeNull();
    expect(parseMoneyToCents("1,2,3")).toBeNull();
    expect(parseMoneyToCents("1,000,000")).toBe(100_000_000);
  });
});

describe("formatMoney", () => {
  it("formats whole dollars without cents", () => {
    expect(formatMoney(1440000)).toBe("$14,400");
    expect(formatMoney(1440050)).toBe("$14,400.50");
    expect(formatMoney(0)).toBe("$0");
  });
});

describe("shortName", () => {
  it("shortens names to first name and last initial", () => {
    expect(shortName("Robert Ortiz")).toBe("Robert O.");
    expect(shortName("  Mary Ann Lee ")).toBe("Mary L.");
    expect(shortName("DJ")).toBe("DJ");
    expect(shortName("Sarah K.")).toBe("Sarah K.");
  });
});

describe("nextStepPill", () => {
  it("reads due days in Eastern time, not UTC", () => {
    expect(nextStepPill(endOfDay("2026-11-05"), lateNov5)).toEqual({ tone: "today", label: "Today" });
    expect(nextStepPill(endOfDay("2026-11-06"), lateNov5)).toEqual({ tone: "future", label: "Tomorrow" });
    expect(nextStepPill(endOfDay("2026-11-02"), lateNov5)).toEqual({ tone: "overdue", label: "Overdue 3d" });
    expect(nextStepPill(endOfDay("2026-11-12"), lateNov5)).toEqual({ tone: "future", label: "Nov 12" });
    expect(nextStepPill(null, lateNov5)).toEqual({ tone: "none", label: "No next step" });
    // a 9 AM activity is still "Today" at 3 PM the same day (day-level colours)
    expect(nextStepPill(zonedDateTime("2026-11-05", "09:00"), new Date("2026-11-05T20:00:00Z")).label).toBe("Today");
  });

  it("says Overdue 1d for yesterday and counts across the DST change", () => {
    expect(nextStepPill(endOfDay("2026-11-04"), lateNov5)).toEqual({ tone: "overdue", label: "Overdue 1d" });
    // Oct 30 to Nov 2 spans the Nov 1 clock change, still 3 calendar days
    expect(nextStepPill(endOfDay("2026-10-30"), zonedDateTime("2026-11-02", "08:00")).label).toBe("Overdue 3d");
  });

  it("adds the chosen time to Today, Tomorrow and dates, but not to Overdue", () => {
    const tomorrow2pm = zonedDateTime("2026-11-06", "14:00");
    expect(nextStepPill(tomorrow2pm, lateNov5, true)).toEqual({ tone: "future", label: "Tomorrow, 2:00 PM" });
    expect(nextStepPill(tomorrow2pm, lateNov5, false)).toEqual({ tone: "future", label: "Tomorrow" });
    // Still amber all day once the time has passed, and it says when it was.
    expect(nextStepPill(zonedDateTime("2026-11-05", "09:00"), lateNov5, true)).toEqual({ tone: "today", label: "Today, 9:00 AM" });
    expect(nextStepPill(zonedDateTime("2026-11-12", "10:30"), lateNov5, true).label).toBe("Nov 12, 10:30 AM");
    expect(nextStepPill(zonedDateTime("2026-11-04", "09:00"), lateNov5, true)).toEqual({ tone: "overdue", label: "Overdue 1d" });
  });

  it("keeps day-only labels when nothing says a time was chosen", () => {
    expect(nextStepPill(zonedDateTime("2026-11-06", "14:00"), lateNov5).label).toBe("Tomorrow");
  });
});

describe("clockTime", () => {
  it("reads the time in Eastern time, with a plain space before AM or PM", () => {
    // 19:00 UTC on Nov 5 is 2 PM Eastern standard time.
    expect(clockTime(new Date("2026-11-05T19:00:00Z"))).toBe("2:00 PM");
    expect(clockTime(zonedDateTime("2026-11-05", "09:30"))).toBe("9:30 AM");
    expect(clockTime(zonedDateTime("2026-11-05", "00:00"))).toBe("12:00 AM");
    // No narrow no-break space (newer Intl): the same text on the server and in every browser.
    expect(clockTime(new Date("2026-11-05T19:00:00Z"))).toMatch(/^[\d:]+ [AP]M$/);
  });

  it("follows the March DST Sunday (2026-03-08) on both sides of the jump", () => {
    // 1:30 AM is still standard time (UTC-5); 9:30 AM is daylight time (UTC-4).
    expect(clockTime(new Date("2026-03-08T06:30:00Z"))).toBe("1:30 AM");
    expect(clockTime(new Date("2026-03-08T07:30:00Z"))).toBe("3:30 AM");
    expect(clockTime(activityDueAt("2026-03-08", "09:30"))).toBe("9:30 AM");
  });

  it("follows the November DST Sunday (2026-11-01), where 1:30 AM happens twice", () => {
    expect(clockTime(new Date("2026-11-01T05:30:00Z"))).toBe("1:30 AM");
    expect(clockTime(new Date("2026-11-01T06:30:00Z"))).toBe("1:30 AM");
    expect(clockTime(activityDueAt("2026-11-01", "09:30"))).toBe("9:30 AM");
  });
});

describe("dueLabel", () => {
  const saturday = zonedDateTime("2026-03-07", "12:00");

  it("adds the clock time only when one was chosen", () => {
    expect(dueLabel(activityDueAt("2026-03-08", "09:30"), true, saturday)).toBe("Tomorrow, 9:30 AM");
    expect(dueLabel(activityDueAt("2026-03-08", null), false, saturday)).toBe("Tomorrow");
  });

  it("names the DST Sunday's own day and time on that Sunday", () => {
    const sundayMorning = zonedDateTime("2026-03-08", "08:00");
    expect(dueLabel(activityDueAt("2026-03-08", "14:00"), true, sundayMorning)).toBe("Today, 2:00 PM");
    expect(dueLabel(activityDueAt("2026-03-09", "08:00"), true, sundayMorning)).toBe("Tomorrow, 8:00 AM");
    expect(dueLabel(activityDueAt("2026-03-07", "17:00"), true, sundayMorning)).toBe("Yesterday, 5:00 PM");
  });
});

describe("daysInStage", () => {
  it("counts calendar days in stage across the November DST change", () => {
    expect(daysInStage(zonedDateTime("2026-10-31", "23:00"), zonedDateTime("2026-11-02", "08:00"))).toBe(2);
    expect(daysInStage(zonedDateTime("2026-11-05", "08:00"), lateNov5)).toBe(0);
  });

  it("never goes negative when the clock is ahead of the server", () => {
    expect(daysInStage(zonedDateTime("2026-11-06", "08:00"), lateNov5)).toBe(0);
  });
});

describe("isRotting", () => {
  it("rots at the threshold, never without one", () => {
    expect(isRotting(14, 14)).toBe(true);
    expect(isRotting(13, 14)).toBe(false);
    expect(isRotting(30, null)).toBe(false);
  });
});

describe("activityDueAt", () => {
  it("stores due times in Eastern time", () => {
    expect(activityDueAt("2026-11-05", null)).toEqual(endOfDay("2026-11-05"));
    expect(activityDueAt("2026-03-08", "09:30").toISOString()).toBe("2026-03-08T13:30:00.000Z");
  });

  it("stores the first morning after the November fall-back as Eastern standard time", () => {
    expect(activityDueAt("2026-11-01", "09:30").toISOString()).toBe("2026-11-01T14:30:00.000Z");
  });
});

describe("isValidDateString", () => {
  it("accepts only real calendar dates", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("26-2-1")).toBe(false);
  });

  it("knows leap years", () => {
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-02-29")).toBe(false);
  });
});

describe("dayLabel", () => {
  it("labels days relative to now", () => {
    expect(dayLabel(new Date("2026-11-05T15:00:00Z"), lateNov5)).toBe("Today");
    expect(dayLabel(new Date("2026-11-04T15:00:00Z"), lateNov5)).toBe("Yesterday");
    expect(dayLabel(new Date("2026-11-03T15:00:00Z"), lateNov5)).toBe("Nov 3");
    expect(dayLabel(new Date("2026-11-06T15:00:00Z"), lateNov5)).toBe("Tomorrow");
  });

  // History groups and the Done list can hold last year's items: "Nov 3" alone
  // would name two different days (M14).
  it("adds the year when the day is in another app-time year", () => {
    expect(dayLabel(new Date("2025-11-03T15:00:00Z"), lateNov5)).toBe("Nov 3, 2025");
    expect(dayLabel(new Date("2027-01-12T15:00:00Z"), lateNov5)).toBe("Jan 12, 2027");
  });

  it("reads the year in app time across New Year", () => {
    // 03:00 UTC on Jan 1 is still 10 PM on Dec 31 in Eastern time: the same year as Dec 20.
    const newYearsEveLate = new Date("2027-01-01T03:00:00Z");
    expect(dayLabel(zonedDateTime("2026-12-20", "12:00"), newYearsEveLate)).toBe("Dec 20");
    expect(dayLabel(zonedDateTime("2027-01-02", "12:00"), newYearsEveLate)).toBe("Jan 2, 2027");
    // 06:00 UTC on Jan 1 is 1 AM on Jan 1 in Eastern time: Dec 20 is now last year.
    const newYearsDayEarly = new Date("2027-01-01T06:00:00Z");
    expect(dayLabel(zonedDateTime("2026-12-20", "12:00"), newYearsDayEarly)).toBe("Dec 20, 2026");
    expect(dayLabel(zonedDateTime("2026-12-31", "23:30"), newYearsDayEarly)).toBe("Yesterday");
    // 11:30 PM on Dec 30 Eastern is already Dec 31 in UTC; it is still 2026 here.
    expect(dayLabel(zonedDateTime("2026-12-30", "23:30"), newYearsDayEarly)).toBe("Dec 30, 2026");
  });

  it("puts the year on a timed due label too", () => {
    expect(dueLabel(zonedDateTime("2025-11-03", "14:05"), true, lateNov5)).toBe("Nov 3, 2025, 2:05 PM");
  });
});

describe("avatarTone", () => {
  it("gives each person a stable avatar tone", () => {
    expect(avatarTone("member-1")).toBe(avatarTone("member-1"));
    expect([0, 1, 2, 3]).toContain(avatarTone("member-2"));
  });

  it("spreads different ids across the four tones", () => {
    const tones = new Set(Array.from({ length: 40 }, (_, i) => avatarTone(`member-${i}`)));
    expect(tones.size).toBe(4);
  });
});
