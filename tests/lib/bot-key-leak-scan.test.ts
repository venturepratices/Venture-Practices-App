import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// A cheap secret scanner for bot keys: no tracked file outside tests/ may hold
// something shaped like a real bot key (vpb_ plus 43 characters), or a bearer
// header with a real-looking value. Tests may hold clearly fake ones.

const REAL_KEY = /vpb_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
const BEARER_VALUE = /Authorization:\s*Bearer\s+vpb_[A-Za-z0-9_-]{8,}/i;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.startsWith("tests/") && /\.(ts|tsx|js|mjs|json|md|sql|env|example|yml|yaml)$/.test(f));
}

describe("no bot key in the repository", () => {
  it("finds no real-looking bot key or bearer value in tracked files", () => {
    const hits = trackedFiles().filter((file) => {
      const text = readFileSync(file, "utf8");
      return REAL_KEY.test(text) || BEARER_VALUE.test(text);
    });
    expect(hits).toEqual([]);
  });

  it("would catch one", () => {
    expect(REAL_KEY.test(`key=vpb_${"A".repeat(43)}`)).toBe(true);
    expect(BEARER_VALUE.test("Authorization: Bearer vpb_abcdefgh")).toBe(true);
  });
});
