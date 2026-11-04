import { describe, expect, it } from "vitest";
import { endOfDay, zonedDateTime } from "@/lib/utils";
import {
  activityDueAt,
  avatarTone,
  dayLabel,
  daysInStage,
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
