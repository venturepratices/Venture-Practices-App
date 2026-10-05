import { describe, expect, it } from "vitest";

import { parseQuarterKey, quarterKeyFor, quarterProgress, quarterRange, shiftQuarter, splitBrainDump } from "@/lib/leadership";
import { endOfDay } from "@/lib/utils";

describe("endOfDay", () => {
  it("lands on the last millisecond of the same day in the app's timezone, not the next day", () => {
    // EST (UTC-5) and EDT (UTC-4) both covered.
    expect(endOfDay("2026-12-31").toISOString()).toBe("2027-01-01T04:59:59.999Z");
    expect(endOfDay("2026-07-04").toISOString()).toBe("2026-07-05T03:59:59.999Z");
  });
});

describe("quarters", () => {
  it("keys a date by its quarter in the app's timezone", () => {
    expect(quarterKeyFor(new Date("2026-10-06T15:00:00Z"))).toBe("2026-Q4");
    // 11pm Sep 30 in Charlotte is still Q3, even though it's Oct 1 in UTC.
    expect(quarterKeyFor(new Date("2026-10-01T03:00:00Z"))).toBe("2026-Q3");
  });

  it("parses and shifts quarter keys across year boundaries", () => {
    expect(parseQuarterKey("2026-Q4")).toEqual({ year: 2026, quarter: 4 });
    expect(parseQuarterKey("2026-Q5")).toBeNull();
    expect(shiftQuarter("2026-Q4", 1)).toBe("2027-Q1");
    expect(shiftQuarter("2026-Q1", -1)).toBe("2025-Q4");
  });

  it("spans the whole quarter: Oct 1 start through Dec 31 end", () => {
    const { start, end } = quarterRange("2026-Q4");
    expect(start.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T04:59:59.999Z");
  });

  it("counts 13 weeks and the current week number", () => {
    expect(quarterProgress("2026-Q4", new Date("2026-10-06T15:00:00Z"))).toMatchObject({ week: 1, totalWeeks: 13 });
    expect(quarterProgress("2026-Q4", new Date("2026-12-31T15:00:00Z"))).toMatchObject({ week: 13, totalWeeks: 13 });
  });
});

describe("splitBrainDump", () => {
  it("makes one issue per non-empty line, stripping bullets, numbers and checkboxes", () => {
    expect(splitBrainDump("- a\n2) b\n\n• c\r\n[x] d\n10. e\n   * f  ")).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("returns nothing for blank input", () => {
    expect(splitBrainDump("\n  \n")).toEqual([]);
  });
});
