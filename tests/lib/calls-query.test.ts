import { describe, expect, it } from "vitest";

import {
  callsQueryToSearch,
  customRangeDays,
  defaultCustomRange,
  parseCallsQuery,
  rangeLabel,
  rangeWindow,
  validateCustomRange,
  type CallsQuery,
} from "@/lib/calls/query";

// The Calls date range: more presets, and exact from/to dates. Days are the
// team's days in Charlotte (America/New_York), not the server's (UTC), so
// "Today" at 9pm Eastern is still today. Fixed clocks below so every answer
// is checkable by hand.

// Friday Nov 20 2026, 10:00 in Charlotte (EST, UTC-5).
const FRI = new Date("2026-11-20T15:00:00Z");

const iso = (d: Date) => d.toISOString();

describe("parseCallsQuery", () => {
  it("defaults to the last 7 days with no custom dates", () => {
    expect(parseCallsQuery({})).toMatchObject({ range: "7d", from: null, to: null });
  });

  it("accepts every preset", () => {
    for (const range of [
      "today", "yesterday", "thisweek", "lastweek", "7d", "14d", "30d", "90d", "month", "lastmonth",
    ]) {
      expect(parseCallsQuery({ range }).range, range).toBe(range);
    }
  });

  it("keeps old links working (7d, 14d, 30d, month)", () => {
    expect(parseCallsQuery({ range: "month" }).range).toBe("month");
  });

  it("an unknown range falls back to 7 days", () => {
    expect(parseCallsQuery({ range: "forever" }).range).toBe("7d");
  });

  it("accepts a custom range with real dates", () => {
    expect(parseCallsQuery({ range: "custom", from: "2026-11-09", to: "2026-11-15" })).toMatchObject({
      range: "custom",
      from: "2026-11-09",
      to: "2026-11-15",
    });
  });

  it("a single-day custom range is allowed", () => {
    expect(parseCallsQuery({ range: "custom", from: "2026-11-09", to: "2026-11-09" }).range).toBe("custom");
  });

  it("a custom range that is incomplete or wrong falls back to 7 days", () => {
    const bad: Array<Record<string, string>> = [
      { range: "custom" },
      { range: "custom", from: "2026-11-09" },
      { range: "custom", to: "2026-11-15" },
      { range: "custom", from: "2026-11-15", to: "2026-11-09" },
      { range: "custom", from: "11/09/2026", to: "11/15/2026" },
      { range: "custom", from: "2026-02-30", to: "2026-03-05" },
      { range: "custom", from: "2025-01-01", to: "2026-11-15" },
    ];
    for (const raw of bad) {
      expect(parseCallsQuery(raw), JSON.stringify(raw)).toMatchObject({ range: "7d", from: null, to: null });
    }
  });

  it("ignores from and to when the range is not custom", () => {
    expect(parseCallsQuery({ range: "30d", from: "2026-11-09", to: "2026-11-15" })).toMatchObject({
      range: "30d",
      from: null,
      to: null,
    });
  });
});

describe("callsQueryToSearch", () => {
  const base: CallsQuery = {
    range: "7d", from: null, to: null, clientId: null, trackingNumber: null, status: "all", page: 1,
  };

  it("leaves out everything that is a default", () => {
    expect(callsQueryToSearch(base)).toBe("");
  });

  it("writes a preset range", () => {
    expect(callsQueryToSearch({ ...base, range: "lastweek" })).toBe("range=lastweek");
  });

  it("writes a custom range with its dates, and reads it back the same", () => {
    const query: CallsQuery = { ...base, range: "custom", from: "2026-11-09", to: "2026-11-15" };
    const search = callsQueryToSearch(query);
    expect(search).toContain("range=custom");
    expect(search).toContain("from=2026-11-09");
    expect(search).toContain("to=2026-11-15");
    const parsed = parseCallsQuery(Object.fromEntries(new URLSearchParams(search)));
    expect(parsed).toMatchObject({ range: "custom", from: "2026-11-09", to: "2026-11-15" });
  });
});

describe("rangeWindow: calendar days are Charlotte days", () => {
  it("today starts at midnight Eastern and runs to now", () => {
    const w = rangeWindow("today", FRI);
    expect(iso(w.start)).toBe("2026-11-20T05:00:00.000Z");
    expect(iso(w.end)).toBe(iso(FRI));
  });

  it("at 9pm Eastern it is still today (UTC has already turned over)", () => {
    const late = new Date("2026-11-21T02:00:00Z");
    expect(iso(rangeWindow("today", late).start)).toBe("2026-11-20T05:00:00.000Z");
  });

  it("yesterday is the whole of the day before", () => {
    const w = rangeWindow("yesterday", FRI);
    expect(iso(w.start)).toBe("2026-11-19T05:00:00.000Z");
    expect(iso(w.end)).toBe("2026-11-20T05:00:00.000Z");
  });

  it("this week starts on Monday", () => {
    expect(iso(rangeWindow("thisweek", FRI).start)).toBe("2026-11-16T05:00:00.000Z");
  });

  it("on a Sunday, this week still started the Monday before", () => {
    const sunday = new Date("2026-11-22T20:00:00Z");
    expect(iso(rangeWindow("thisweek", sunday).start)).toBe("2026-11-16T05:00:00.000Z");
  });

  it("just after midnight Monday a new week has started", () => {
    const monday = new Date("2026-11-23T06:00:00Z");
    expect(iso(rangeWindow("thisweek", monday).start)).toBe("2026-11-23T05:00:00.000Z");
  });

  it("last week is the Monday to Sunday before this week", () => {
    const w = rangeWindow("lastweek", FRI);
    expect(iso(w.start)).toBe("2026-11-09T05:00:00.000Z");
    expect(iso(w.end)).toBe("2026-11-16T05:00:00.000Z");
  });

  it("this month starts on the 1st (midnight Nov 1 is still daylight time)", () => {
    expect(iso(rangeWindow("month", FRI).start)).toBe("2026-11-01T04:00:00.000Z");
  });

  it("last month is the whole of October", () => {
    const w = rangeWindow("lastmonth", FRI);
    expect(iso(w.start)).toBe("2026-10-01T04:00:00.000Z");
    expect(iso(w.end)).toBe("2026-11-01T04:00:00.000Z");
  });

  it("last month in January reaches back into December of the year before", () => {
    const jan = new Date("2027-01-15T15:00:00Z");
    const w = rangeWindow("lastmonth", jan);
    expect(iso(w.start)).toBe("2026-12-01T05:00:00.000Z");
    expect(iso(w.end)).toBe("2027-01-01T05:00:00.000Z");
  });

  it("the rolling ranges count back from now", () => {
    expect(iso(rangeWindow("7d", FRI).start)).toBe("2026-11-13T15:00:00.000Z");
    expect(iso(rangeWindow("14d", FRI).start)).toBe("2026-11-06T15:00:00.000Z");
    expect(iso(rangeWindow("30d", FRI).start)).toBe("2026-10-21T15:00:00.000Z");
    expect(iso(rangeWindow("90d", FRI).start)).toBe("2026-08-22T15:00:00.000Z");
    expect(iso(rangeWindow("7d", FRI).end)).toBe(iso(FRI));
  });

  it("a custom range covers both dates in full, even across the clocks changing back", () => {
    const w = rangeWindow("custom", FRI, "2026-10-31", "2026-11-02");
    expect(iso(w.start)).toBe("2026-10-31T04:00:00.000Z");
    expect(iso(w.end)).toBe("2026-11-03T05:00:00.000Z");
    expect((w.end.getTime() - w.start.getTime()) / 3600000).toBe(73);
  });

  it("a custom range with no dates behaves like the last 7 days", () => {
    expect(iso(rangeWindow("custom", FRI).start)).toBe("2026-11-13T15:00:00.000Z");
  });
});

describe("custom range helpers", () => {
  it("checks the dates and says what is wrong in plain words", () => {
    expect(validateCustomRange("2026-11-09", "2026-11-15")).toBeNull();
    expect(validateCustomRange("", "2026-11-15")).toBe("Choose both dates.");
    expect(validateCustomRange("2026-11-09", "")).toBe("Choose both dates.");
    expect(validateCustomRange("2026-11-15", "2026-11-09")).toBe("The end date must be on or after the start date.");
    expect(validateCustomRange("2025-01-01", "2026-11-15")).toBe("Choose a range of one year or less.");
  });

  it("allows exactly one year (366 days) but not more", () => {
    expect(validateCustomRange("2026-01-01", "2026-12-31")).toBeNull();
    expect(validateCustomRange("2025-01-01", "2026-01-02")).toBe("Choose a range of one year or less.");
  });

  it("counts days with both dates included", () => {
    expect(customRangeDays("2026-11-09", "2026-11-09")).toBe(1);
    expect(customRangeDays("2026-11-09", "2026-11-15")).toBe(7);
    expect(customRangeDays("2026-10-31", "2026-11-02")).toBe(3);
  });

  it("the starting custom range is the last 7 days ending today in Charlotte", () => {
    expect(defaultCustomRange(FRI)).toEqual({ from: "2026-11-14", to: "2026-11-20" });
    expect(defaultCustomRange(new Date("2026-11-21T02:00:00Z"))).toEqual({ from: "2026-11-14", to: "2026-11-20" });
  });
});

describe("rangeLabel", () => {
  it("names each preset", () => {
    expect(rangeLabel("today")).toBe("Today");
    expect(rangeLabel("yesterday")).toBe("Yesterday");
    expect(rangeLabel("thisweek")).toBe("This week (Mon to Sun)");
    expect(rangeLabel("lastweek")).toBe("Last week (Mon to Sun)");
    expect(rangeLabel("7d")).toBe("Last 7 days");
    expect(rangeLabel("90d")).toBe("Last 90 days");
    expect(rangeLabel("month")).toBe("This month");
    expect(rangeLabel("lastmonth")).toBe("Last month");
  });

  it("writes a custom range as the two dates", () => {
    expect(rangeLabel("custom", "2026-11-09", "2026-11-15")).toBe("Nov 9, 2026 to Nov 15, 2026");
  });

  it("a custom range without dates still has a name", () => {
    expect(rangeLabel("custom")).toBe("Custom range");
  });
});
