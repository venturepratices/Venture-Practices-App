import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Sales shows people as first name and last initial, and its code never names
// a real team member in full (K4, M9). Where a comment or string shows how a
// full name is shortened ("Dana Example" -> "Dana E."), the full name is the
// made-up "Example" surname. This reads every Sales source file for such
// examples: a quoted first and last name followed by an arrow.

const SALES_SOURCES = [
  ["src", "lib", "sales"],
  ["src", "components", "sales"],
  ["src", "app", "(app)", "sales"],
  ["src", "app", "api", "sales"],
].map((parts) => path.join(process.cwd(), ...parts));

const NAME_EXAMPLE = /"([A-Z][a-z]+) ([A-Z][a-z]+)"\s*(?:->|=>|→)/g;

function sourceFiles(): string[] {
  return SALES_SOURCES.flatMap((dir) =>
    fs
      .readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => path.join(dir, file)),
  );
}

/** Each "First Last" -> example in a file, as "First Last". */
function nameExamples(source: string): string[] {
  return [...source.matchAll(NAME_EXAMPLE)].map((match) => `${match[1]} ${match[2]}`);
}

describe("full names in Sales code are made up (K4)", () => {
  const files = sourceFiles();

  it("finds the Sales code, with its name-shortening examples", () => {
    const names = files.map((file) => path.basename(file));
    expect(names).toEqual(expect.arrayContaining(["format.ts", "board-client.ts", "deal-history.tsx", "page.tsx", "route.ts"]));
    const examples = files.flatMap((file) => nameExamples(fs.readFileSync(file, "utf8")));
    expect(examples.length).toBeGreaterThanOrEqual(2);
  });

  it.each(files.map((file) => [path.relative(process.cwd(), file), file]))("%s shortens only made-up full names", (_name, file) => {
    const real = nameExamples(fs.readFileSync(file, "utf8")).filter((name) => !name.endsWith(" Example"));
    expect(real).toEqual([]);
  });

  it("would catch any other full name", () => {
    expect(nameExamples('/** "Dana Lastname" -> "Dana L." */')).toEqual(["Dana Lastname"]);
    expect(nameExamples('// ("Dana Lastname" -> "DL", "Sarah K." -> "SK")')).toEqual(["Dana Lastname"]);
    expect(nameExamples('/** "Dana Example" -> "Dana E." */').filter((name) => !name.endsWith(" Example"))).toEqual([]);
  });
});
