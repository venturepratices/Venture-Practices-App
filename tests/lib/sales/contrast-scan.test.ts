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
