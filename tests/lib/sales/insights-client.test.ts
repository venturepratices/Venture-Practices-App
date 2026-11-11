import { describe, expect, it } from "vitest";

import { contrast, token, type Theme } from "./theme-colours";

// The Insights page's pure helpers (Decision 27, Mockup v2 `viewInsights`):
// range labels, month strings, horizontal-bar widths, the weighted cycle-time
// average and its sentence, compact-money for chart labels, and the "nice" axis
// scale shared by the column and line charts. Client-safe: no prisma, no server
// imports.

const {
  INSIGHTS_RANGES,
  rangeWords,
  monthLabel,
  monthLong,
  barPercents,
  averageCycleDays,
  cycleLabel,
  compactMoney,
  niceScale,
  CHART_SERIES_TOKEN,
} = await import("@/lib/sales/insights-client");

const THEMES: readonly Theme[] = ["light", "dark"];

describe("INSIGHTS_RANGES and rangeWords", () => {
  it("lists the three ranges the filter offers, in order", () => {
    expect(INSIGHTS_RANGES).toEqual([
      { value: 3, label: "Last 3 months" },
      { value: 6, label: "Last 6 months" },
      { value: 12, label: "Last 12 months" },
    ]);
  });

  it("rangeWords reads the range as a phrase for every caption", () => {
    expect(rangeWords(6)).toBe("the last 6 months");
    expect(rangeWords(3)).toBe("the last 3 months");
    expect(rangeWords(12)).toBe("the last 12 months");
  });
});

describe("monthLabel and monthLong", () => {
  it("monthLabel reads a YYYY-MM as its short month", () => {
    expect(monthLabel("2026-11")).toBe("Nov");
    expect(monthLabel("2026-01")).toBe("Jan");
  });

  it("monthLong reads the month with its year, and marks this month so far", () => {
    expect(monthLong("2026-11", true)).toBe("Nov 2026 (so far)");
    expect(monthLong("2025-12", false)).toBe("Dec 2025");
  });
});

describe("barPercents", () => {
  it("scales values so the biggest fills the bar", () => {
    expect(barPercents([2, 4, 0])).toEqual([50, 100, 0]);
  });

  it("gives every row 0 when nothing happened", () => {
    expect(barPercents([0, 0])).toEqual([0, 0]);
  });

  it("gives an empty list back when nothing was asked for", () => {
    expect(barPercents([])).toEqual([]);
  });
});

describe("averageCycleDays and cycleLabel", () => {
  it("averages days by deals won, rounded to a whole day", () => {
    expect(
      averageCycleDays([
        { avgDays: 12, count: 2 },
        { avgDays: 20, count: 1 },
        { avgDays: null, count: 0 },
      ]),
    ).toBe(15);
  });

  it("gives null when nothing was won in the range", () => {
    expect(
      averageCycleDays([
        { avgDays: null, count: 0 },
        { avgDays: null, count: 0 },
      ]),
    ).toBeNull();
  });

  it("cycleLabel reads the sentence helpers want", () => {
    expect(cycleLabel(null)).toBe("No wins");
    expect(cycleLabel(1)).toBe("1 day");
    expect(cycleLabel(12)).toBe("12 days");
  });
});

describe("compactMoney", () => {
  it("writes small amounts in whole dollars", () => {
    expect(compactMoney(0)).toBe("$0");
    expect(compactMoney(90000)).toBe("$900");
  });

  it("writes thousands with one decimal unless it is whole or over a hundred", () => {
    expect(compactMoney(150000)).toBe("$1.5K");
    expect(compactMoney(1200000)).toBe("$12K");
    expect(compactMoney(12000000)).toBe("$120K");
  });

  it("writes millions with one decimal", () => {
    expect(compactMoney(120000000)).toBe("$1.2M");
  });
});

describe("niceScale", () => {
  it("rounds the top up and picks a step that divides it", () => {
    expect(niceScale(14400, 3)).toEqual({ step: 5000, top: 15000 });
    expect(niceScale(10, 3)).toEqual({ step: 5, top: 10 });
    expect(niceScale(45, 3)).toEqual({ step: 20, top: 60 });
  });
});

describe("the series colour stands out from its card in both themes", () => {
  it.each(THEMES)("%s theme: non-text contrast is at least 3", (theme) => {
    expect(contrast(token(CHART_SERIES_TOKEN, theme), token("card", theme))).toBeGreaterThanOrEqual(3);
  });
});
