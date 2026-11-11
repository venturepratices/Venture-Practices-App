import fs from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { contrast, shown, utilityColour } from "./theme-colours";

// Grey text on the grey (muted) fill: History's "locked" pill, a card's
// days-in-stage pill and a stage not reached yet (K3, M12). The muted grey on
// the muted fill is 4.32:1 in light, under spec 7.11's 4.5:1 for text, so all
// three take one shared tone from sales-pills.tsx: slate-600 in light (6.9:1),
// the muted grey in dark (5.5:1). 11px semibold is not large text.
//
// The same muted grey on the pale accent fill is also 4.32:1 in light. Grey
// words that can sit on that fill (a column while a card is dragged over it, a
// highlighted option in a list) take MUTED_TEXT, the text half of MUTED_TONE.

const { MUTED_TEXT, MUTED_TONE, DaysPill } = await import("@/components/sales/sales-pills");
const { DealHistory } = await import("@/components/sales/deal-history");

const THEMES = ["light", "dark"] as const;
const classList = (value: string) => value.split(/\s+/).filter(Boolean);

/** The shared tone's classes. */
function tone(): string[] {
  expect(MUTED_TONE, "MUTED_TONE from sales-pills.tsx").toBeTypeOf("string");
  return classList(MUTED_TONE);
}

/** History, as the deal panel shows it once loaded; the "locked" pill sits in its heading. */
function historyLockPill(): string[] {
  const html = renderToString(
    createElement(DealHistory, {
      history: { status: "ready", entries: [], hasOlder: false, loadingOlder: false },
      now: new Date("2026-11-05T21:00:00.000Z"),
      onShowOlder: vi.fn(),
      onRetry: vi.fn(),
      onSaved: vi.fn(),
    }),
  );
  const pill = /<span title="Nobody can edit or delete history" class="([^"]*)"/.exec(html);
  expect(pill).not.toBeNull();
  return classList(pill![1]);
}

/** A card's "9d" pill for a deal that is not rotting yet. */
function daysPill(): string[] {
  const html = renderToString(createElement(DaysPill, { days: 9, rotting: false }));
  const pill = /<span role="img" aria-label="9 days in this stage"[^>]*class="([^"]*)"/.exec(html);
  expect(pill).not.toBeNull();
  return classList(pill![1]);
}

describe("grey text on the grey fill in Sales (K3, spec 7.11)", () => {
  it.each(THEMES)("the shared tone passes AA in %s mode", (theme) => {
    const classes = tone();
    expect(contrast(shown(classes, "text", theme), shown(classes, "bg", theme))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the look: the muted fill, a darker grey of the same hue in light, the muted grey in dark", () => {
    expect(tone()).toEqual(["bg-muted", "text-slate-600", "dark:text-muted-foreground"]);
  });

  it.each([
    ["History's locked pill", historyLockPill],
    ["the days-in-stage pill", daysPill],
  ] as const)("%s uses the shared tone", (_name, pill) => {
    expect(pill()).toEqual(expect.arrayContaining(tone()));
  });

  it.each(
    (["History's locked pill", "the days-in-stage pill"] as const).flatMap((name) => THEMES.map((theme) => [name, theme] as const)),
  )("%s passes AA in %s mode", (name, theme) => {
    const classes = name === "History's locked pill" ? historyLockPill() : daysPill();
    expect(contrast(shown(classes, "text", theme), shown(classes, "bg", theme))).toBeGreaterThanOrEqual(4.5);
  });

  it("measures the pair that fails (the muted grey on the muted fill in light mode is 4.32:1)", () => {
    expect(contrast(utilityColour("text-muted-foreground", "light")!, utilityColour("bg-muted", "light")!)).toBeCloseTo(4.32, 2);
  });
});

/** A Sales component's source, read as text. */
function componentSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", "components", "sales", file), "utf8");
}

describe("grey words on the accent fill in Sales (spec 7.11)", () => {
  it("measures the pair that fails on the accent fill", () => {
    expect(contrast(utilityColour("text-muted-foreground", "light")!, utilityColour("bg-accent", "light")!)).toBeCloseTo(4.32, 2);
  });

  it.each(THEMES)("grey words on the accent fill pass AA in %s mode", (theme) => {
    expect(contrast(shown(classList(MUTED_TEXT), "text", theme), utilityColour("bg-accent", theme)!)).toBeGreaterThanOrEqual(4.5);
  });

  it("MUTED_TONE is the muted fill plus MUTED_TEXT", () => {
    expect(MUTED_TEXT).toBe("text-slate-600 dark:text-muted-foreground");
    expect(MUTED_TONE).toBe(`bg-muted ${MUTED_TEXT}`);
  });

  it("the drag-over column and the highlighted option use MUTED_TEXT", () => {
    const board = componentSource("deals-board.tsx");
    const start = board.indexOf("function StageColumn");
    const end = board.indexOf("function DropBar");
    expect(start, "function StageColumn in deals-board.tsx").toBeGreaterThanOrEqual(0);
    expect(end, "function DropBar after it").toBeGreaterThan(start);
    expect(board.slice(start, end)).not.toContain("text-muted-foreground");

    // The highlighted option's detail line lives in the shared contact picker (Add deal, new lead, convert, Details).
    const detailLines = componentSource("contact-picker.tsx")
      .split(/\r?\n/)
      .filter((line) => line.includes("{choice.detail}"));
    expect(detailLines).toHaveLength(1);
    expect(detailLines[0]).toContain("MUTED_TEXT");
  });
});
