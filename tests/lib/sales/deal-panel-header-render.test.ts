import fs from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BoardStage } from "@/lib/sales/board";
import type { DealPanelData } from "@/lib/sales/deal-panel";

// A server render of the deal panel's header (deal-panel-header.tsx) with
// canned data. Node has no browser, so this cannot tap a stage; it proves the
// caption under the stage bar and the stage bar's markup on every screen size.

const { DealPanelHeader } = await import("@/components/sales/deal-panel-header");
const { Sheet } = await import("@/components/ui/sheet");

const NOW = new Date("2026-11-05T15:00:00.000Z");

function stage(id: string, name: string, position: number, probability: number, extra: Partial<BoardStage> = {}): BoardStage {
  return {
    id,
    key: id,
    name,
    position,
    probability,
    isWon: false,
    isLost: false,
    requiresValue: false,
    isNoShow: false,
    rottingDays: 14,
    ...extra,
  };
}

const STAGES = [
  stage("s1", "New Opt-In", 0, 10),
  stage("s2", "Appointment Scheduled", 1, 20),
  stage("s3", "Demo Complete", 2, 30),
  stage("s4", "Proposal Sent", 3, 60, { requiresValue: true }),
  stage("s5", "Contract Signed", 4, 100, { isWon: true, rottingDays: null }),
];

const MEMBERS = [
  { id: "u1", name: "Ben Shaver" },
  { id: "u2", name: "Dana Q." },
];

function panel(deal: Partial<DealPanelData["deal"]> = {}): DealPanelData {
  return {
    deal: {
      id: "d1",
      title: "Bright Smile Dental",
      status: "OPEN",
      valueCents: 1_440_000,
      mrrCents: 120_000,
      stageId: "s3",
      stageEnteredAt: "2026-11-04T15:00:00.000Z",
      lostReason: null,
      lostComment: null,
      source: null,
      owner: MEMBERS[0],
      organization: { id: "o1", name: "Bright Smile Dental" },
      person: { id: "pe1", name: "Sarah K." },
      ...deal,
    },
    pipeline: { id: "p1", key: "direct-mail", name: "Direct Mail", kind: "SALES" },
    stages: STAGES,
    openActivities: [],
    fields: [],
    members: MEMBERS,
    canEdit: true,
    territoryHold: null,
  };
}

/** The header's close button belongs to the panel's Sheet, so it renders inside one. */
function render(data: DealPanelData): string {
  const moves = { move: vi.fn(), setStatus: vi.fn(), editValue: vi.fn() };
  return renderToString(
    createElement(Sheet, null, createElement(DealPanelHeader, { data, now: NOW, moves, titleId: "t", onChanged: vi.fn() })),
  ).replaceAll("<!-- -->", "");
}

describe("deal panel header: the caption under the stage bar", () => {
  it("gives an open deal its stage, days in it and win chance", () => {
    expect(render(panel())).toContain(">Demo Complete · 1 day in this stage · 30% win chance</p>");
  });

  it("gives a lost deal its status, never the stage's win chance (C3)", () => {
    const html = render(panel({ status: "LOST", stageId: "s5", lostReason: "Price" }));
    expect(html).toContain(">Lost · Contract Signed</p>");
    expect(html).not.toContain("win chance");
    expect(html).not.toContain("in this stage");
  });

  it("gives a won deal its status", () => {
    expect(render(panel({ status: "WON", stageId: "s5" }))).toContain(">Won · Contract Signed</p>");
  });
});

/** The stage bar's own classes, and each chevron's classes with its visible name's classes. */
function stageBar(html: string) {
  const bar = /<div role="group" aria-label="Stage"[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  expect(bar).not.toBeNull();
  const chevrons = [...bar![2].matchAll(/<button[^>]*class="([^"]*)"[^>]*><span class="([^"]*)">([^<]*)<\/span><\/button>/g)].map(
    (match) => ({ button: match[1].split(/\s+/), label: match[2].split(/\s+/), name: match[3] }),
  );
  return { classes: bar![1].split(/\s+/), chevrons };
}

describe("deal panel header: the stage bar on phones (C4)", () => {
  it("shows every stage's name at every screen size, never as screen-reader-only text", () => {
    // At 375px the chevrons used to be bare colours: tapping a stage to move the deal was blind.
    const { chevrons } = stageBar(render(panel()));
    expect(chevrons.map((chevron) => chevron.name)).toEqual(STAGES.map((s) => s.name));
    for (const { label, name } of chevrons) {
      expect(label.filter((className) => className.includes("sr-only")), name).toEqual([]);
    }
  });

  // The readable bar (whole names, scrolling sideways inside itself) is for every
  // screen under the md breakpoint and for every touch screen, tablets included:
  // a touch can never show the `title` that holds a cut-off name (M11).
  const READABLE_WHEN = ["max-md", "pointer-coarse"];

  it.each(READABLE_WHEN)("scrolls sideways inside itself (%s)", (when) => {
    const { classes } = stageBar(render(panel()));
    // Its own scroller: the page itself never scrolls sideways.
    expect(classes).toEqual(expect.arrayContaining(["relative", `${when}:overflow-x-auto`, `${when}:overscroll-x-contain`]));
  });

  it.each(READABLE_WHEN)("gives each chevron its whole name at 12px (%s)", (when) => {
    for (const { button, name } of stageBar(render(panel())).chevrons) {
      // A chevron that grows but never shrinks keeps its whole name, and a short pipeline still fills the bar.
      expect(button, name).toEqual(
        expect.arrayContaining([`${when}:flex-[1_0_auto]`, `${when}:min-w-20`, `${when}:px-3.5`, `${when}:text-xs`]),
      );
    }
  });

  it("shares the width out as the mockup does for a mouse on a wider screen", () => {
    const { classes, chevrons } = stageBar(render(panel()));
    expect(classes.filter((className) => className.startsWith("overflow-"))).toEqual([]);
    for (const { button, name } of chevrons) {
      expect(button, name).toEqual(expect.arrayContaining(["flex-1", "min-w-0", "px-2.5", "text-[10.5px]"]));
    }
  });
});

// --- Colours (spec 7.11: every stage name needs 4.5:1, in light and in dark) ---
//
// Each chevron's text and background are resolved from its rendered classes:
// the app's tokens from globals.css (`:root` for light, `.dark` over it for
// dark, where `dark:` classes also apply) and Tailwind's palette from its own
// theme file. 10.5px and 12px semibold are not large text, so 4.5:1 applies.

type Linear = [number, number, number];
type Theme = "light" | "dark";

const GLOBALS_CSS = fs.readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
const TAILWIND_THEME = fs.readFileSync(path.join(process.cwd(), "node_modules", "tailwindcss", "theme.css"), "utf8");

/** The custom properties set in one top-level block, `--muted` as "muted". */
function properties(css: string, block: RegExp): Map<string, string> {
  const body = block.exec(css);
  expect(body, String(block)).not.toBeNull();
  return new Map([...body![1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

const LIGHT = properties(GLOBALS_CSS, /^:root \{([\s\S]*?)^\}/m);
const DARK = new Map([...LIGHT, ...properties(GLOBALS_CSS, /^\.dark \{([\s\S]*?)^\}/m)]);
const PALETTE = properties(TAILWIND_THEME, /@theme default \{([\s\S]*?)^\}/m);

/** A colour as linear sRGB, from `#rrggbb` or `oklch(L C H)`; null for anything else. */
function linear(value: string): Linear | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    return [0, 2, 4].map((i) => {
      const c = parseInt(hex[1].slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as Linear;
  }
  const oklch = /^oklch\(([\d.]+)(%?) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (!oklch) return null;
  const l = Number(oklch[1]) / (oklch[2] ? 100 : 1);
  const hue = (Number(oklch[4]) * Math.PI) / 180;
  const a = Number(oklch[3]) * Math.cos(hue);
  const b = Number(oklch[3]) * Math.sin(hue);
  const lms = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map(
    (x) => x ** 3,
  );
  return [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ].map((x) => Math.min(1, Math.max(0, x))) as Linear;
}

/** The colour a `bg-*` or `text-*` utility paints in a theme; null for a size such as `text-xs`. */
function utilityColour(utility: string, theme: Theme): Linear | null {
  const name = utility.replace(/^(bg|text)-/, "");
  if (name === "white") return [1, 1, 1];
  const value = (theme === "dark" ? DARK : LIGHT).get(name) ?? PALETTE.get(`color-${name}`);
  return value ? linear(value) : null;
}

/** The one text or background colour a chevron shows in a theme (`dark:` classes win in dark). */
function shown(classes: string[], kind: "bg" | "text", theme: Theme): Linear {
  const pick = (list: string[]) =>
    list
      .filter((c) => c.startsWith(`${kind}-`))
      .map((c) => utilityColour(c, theme))
      .filter((colour): colour is Linear => colour !== null);
  const plain = pick(classes);
  const dark = theme === "dark" ? pick(classes.filter((c) => c.startsWith("dark:")).map((c) => c.slice(5))) : [];
  expect(plain, `${kind} colour`).toHaveLength(1);
  return dark[0] ?? plain[0];
}

const luminance = ([r, g, b]: Linear) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function contrast(a: Linear, b: Linear): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

describe("deal panel header: stage names pass AA in light and dark (spec 7.11)", () => {
  // The deal sits in Demo Complete: New Opt-In and Appointment Scheduled are passed, Proposal Sent not reached yet.
  const { chevrons } = stageBar(render(panel()));
  const CHEVRONS = { passed: chevrons[0], current: chevrons[2], "not reached": chevrons[3] };

  it.each(
    (["passed", "current", "not reached"] as const).flatMap((state) => (["light", "dark"] as const).map((theme) => [state, theme] as const)),
  )("a %s stage's name in %s mode", (state, theme) => {
    const { button } = CHEVRONS[state];
    expect(contrast(shown(button, "text", theme), shown(button, "bg", theme))).toBeGreaterThanOrEqual(4.5);
  });

  it("measures the colours that fail (the muted grey on the muted fill in light mode is 4.32:1)", () => {
    const muted = utilityColour("bg-muted", "light")!;
    expect(contrast(utilityColour("text-muted-foreground", "light")!, muted)).toBeCloseTo(4.32, 2);
    expect(contrast([1, 1, 1], utilityColour("bg-green-600", "light")!)).toBeLessThan(4.5);
    expect(contrast(utilityColour("text-muted-foreground", "dark")!, utilityColour("bg-muted", "dark")!)).toBeCloseTo(5.49, 2);
  });
});
