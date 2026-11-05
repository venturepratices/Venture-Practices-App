import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Spec 7.11 sets WCAG AA as the floor: white text needs 4.5:1 against what it
// sits on. With Tailwind 4's palette, white on green-600 is 3.2:1 (fails), on
// green-700 4.9:1 and on green-800 7.1:1; green-700 at 90% over white drops to
// 4.2:1. So a filled green that carries white (the Won button, passed stages,
// the Won drop zone, a ticked check) is green-700, darkening to green-800 on
// hover. This reads every class string in the Sales screens and refuses white
// on a lighter or see-through green.

const SALES_COMPONENTS = path.join(process.cwd(), "src", "components", "sales");
const TOO_LIGHT_FOR_WHITE = /(?:^|[\s"'`:])bg-green-(?:[1-6]00|700\/\d+)(?=[\s"'`]|$)/;

function classStrings(source: string): string[] {
  return source.match(/"[^"\n]*"|`[^`]*`/g) ?? [];
}

describe("white text on green in the Sales screens", () => {
  const files = fs.readdirSync(SALES_COMPONENTS).filter((file) => file.endsWith(".tsx"));

  it("finds the Sales screens to check", () => {
    expect(files).toContain("deal-panel-header.tsx");
    expect(files).toContain("deals-board.tsx");
  });

  it.each(files)("%s puts white only on green-700 or darker", (file) => {
    const source = fs.readFileSync(path.join(SALES_COMPONENTS, file), "utf8");
    const offenders = classStrings(source).filter(
      (literal) => literal.includes("text-white") && TOO_LIGHT_FOR_WHITE.test(literal),
    );
    expect(offenders).toEqual([]);
  });

  it("would catch the colours that fail", () => {
    for (const bad of ['"bg-green-600 text-white"', '"bg-green-700 text-white hover:bg-green-700/90"', '"text-white dark:bg-green-500"']) {
      expect(TOO_LIGHT_FOR_WHITE.test(bad), bad).toBe(true);
    }
    for (const good of ['"bg-green-700 text-white hover:bg-green-800"', '"bg-green-800 text-white"']) {
      expect(TOO_LIGHT_FOR_WHITE.test(good), good).toBe(false);
    }
  });
});

// Grey text on the solid grey fill (K3). The muted grey on `bg-muted` is 4.32:1
// in light, under 4.5:1, so a pill, chip or chevron with grey words on the grey
// fill takes MUTED_TONE from sales-pills.tsx (slate-600 in light). An icon on
// its own needs 3:1 (WCAG 1.4.11), so the icon-only boxes in History and Next
// steps keep the plain pair.

const SALES_PAGES = path.join(process.cwd(), "src", "app", "(app)", "sales");
const SOLID_MUTED = /(?:^|[\s"'`])bg-muted(?=[\s"'`]|$)/;
const MUTED_TEXT = /(?:^|[\s"'`])text-muted-foreground(?=[\s"'`]|$)/;
const ICON_ONLY: Record<string, number> = { "deal-history.tsx": 1, "next-steps.tsx": 1 };

describe("grey text on the grey fill in the Sales screens (K3)", () => {
  const files = [
    ...fs.readdirSync(SALES_COMPONENTS).filter((file) => file.endsWith(".tsx")).map((file) => path.join(SALES_COMPONENTS, file)),
    ...fs
      .readdirSync(SALES_PAGES, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => path.join(SALES_PAGES, file)),
  ];

  it("finds the Sales screens and pages to check", () => {
    expect(files.map((file) => path.basename(file))).toEqual(expect.arrayContaining(["sales-pills.tsx", "deal-history.tsx", "page.tsx"]));
  });

  it.each(files.map((file) => [path.relative(process.cwd(), file), file]))("%s puts grey words on the grey fill only in the shared tone", (_name, file) => {
    const offenders = classStrings(fs.readFileSync(file, "utf8")).filter((literal) => SOLID_MUTED.test(literal) && MUTED_TEXT.test(literal));
    const iconOnly = path.dirname(file) === SALES_COMPONENTS ? (ICON_ONLY[path.basename(file)] ?? 0) : 0;
    expect(offenders).toHaveLength(iconOnly);
  });

  it("would catch the pair that fails", () => {
    for (const bad of ['"bg-muted text-muted-foreground"', '"rounded-full bg-muted px-2 text-[11px] text-muted-foreground"']) {
      expect(SOLID_MUTED.test(bad) && MUTED_TEXT.test(bad), bad).toBe(true);
    }
    for (const good of ['"bg-muted text-slate-600 dark:text-muted-foreground"', '"bg-muted/40 text-muted-foreground"', '"hover:bg-muted text-muted-foreground"']) {
      expect(SOLID_MUTED.test(good) && MUTED_TEXT.test(good), good).toBe(false);
    }
  });
});
