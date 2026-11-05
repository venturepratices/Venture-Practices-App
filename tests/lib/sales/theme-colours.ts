import fs from "node:fs";
import path from "node:path";

import { expect } from "vitest";

// Colours as the browser paints them, for spec 7.11's contrast checks (WCAG
// AA: 4.5:1 for text under 18.66px bold or 24px). A class such as `bg-muted`,
// `text-slate-600` or `hover:bg-muted/60` is resolved from the app's tokens in
// globals.css (`:root` for light, `.dark` over it for dark) and Tailwind's
// palette from its own theme file. Not a test file: the contrast tests share it.

export type Linear = [number, number, number];
export type Theme = "light" | "dark";

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

const encode = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** `top` at `alpha` over `base`, mixed as the browser composites: in gamma-encoded sRGB. */
export function over(top: Linear, alpha: number, base: Linear): Linear {
  return top.map((c, i) => decode(alpha * encode(c) + (1 - alpha) * encode(base[i]))) as Linear;
}

/** A theme token, such as "background" or "card", as a colour. */
export function token(name: string, theme: Theme): Linear {
  const colour = linear((theme === "dark" ? DARK : LIGHT).get(name) ?? "");
  expect(colour, name).not.toBeNull();
  return colour!;
}

/**
 * The colour a `bg-*` or `text-*` utility paints in a theme, and its opacity
 * (`bg-muted/60` is the muted fill at 0.6); null for a size such as `text-xs`.
 */
export function paint(utility: string, theme: Theme): { colour: Linear; alpha: number } | null {
  const [, name, percent] = /^(?:bg|text)-([^/]+)(?:\/(\d+))?$/.exec(utility) ?? [];
  if (!name) return null;
  const alpha = percent ? Number(percent) / 100 : 1;
  if (name === "white") return { colour: [1, 1, 1], alpha };
  const value = (theme === "dark" ? DARK : LIGHT).get(name) ?? PALETTE.get(`color-${name}`);
  const colour = value ? linear(value) : null;
  return colour ? { colour, alpha } : null;
}

/** The colour of a solid utility, as `paint` without the opacity. */
export function utilityColour(utility: string, theme: Theme): Linear | null {
  return paint(utility, theme)?.colour ?? null;
}

/**
 * The one text or background colour an element shows in a theme while the
 * given variants hold (for example `["hover", "enabled"]`): of the classes
 * whose every variant holds (`dark:` holds in dark), the one with the most
 * variants wins, as Tailwind's more specific selector does. Its opacity comes
 * with it.
 */
export function shownPaint(
  classes: string[],
  kind: "bg" | "text",
  theme: Theme,
  holding: string[] = [],
): { colour: Linear; alpha: number } {
  const active = new Set(theme === "dark" ? [...holding, "dark"] : holding);
  const candidates = classes
    .map((name) => {
      const parts = name.split(":");
      const utility = parts.pop()!;
      if (!utility.startsWith(`${kind}-`) || !parts.every((variant) => active.has(variant))) return null;
      const painted = paint(utility, theme);
      return painted ? { ...painted, variants: parts.length, name } : null;
    })
    .filter((candidate) => candidate !== null);
  expect(candidates.length, `${kind} colour in ${classes.join(" ")}`).toBeGreaterThan(0);
  const most = Math.max(...candidates.map((candidate) => candidate.variants));
  const winners = candidates.filter((candidate) => candidate.variants === most);
  expect(winners.map((winner) => winner.name), `one ${kind} colour`).toHaveLength(1);
  return winners[0];
}

/** As `shownPaint`, for a solid colour. */
export function shown(classes: string[], kind: "bg" | "text", theme: Theme, holding: string[] = []): Linear {
  return shownPaint(classes, kind, theme, holding).colour;
}

const luminance = ([r, g, b]: Linear) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function contrast(a: Linear, b: Linear): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
