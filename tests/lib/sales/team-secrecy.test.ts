import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Sales is secret from one team member. /team is open to people without Sales
// access (they get the availability tab), and Next sends a page every client
// chunk it statically imports, whether or not that part of the page renders
// for them. The member form dialog names Sales (the permission label and the
// canUseSales / salesSeesAllDeals field names), so it must reach /team only
// through a lazy import that is rendered for admins alone, never as a static
// import of the page. The build-level proof lives in
// scripts/check-sales-secrecy.ts (run it after a build); this is the check that
// runs on every `npm test`.

const SRC = path.join(process.cwd(), "src");
const read = (relative: string) => fs.readFileSync(path.join(SRC, ...relative.split("/")), "utf8");
const sourceFiles = (dir = "") =>
  (fs.readdirSync(path.join(SRC, dir), { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => /\.(ts|tsx)$/.test(file) && !file.startsWith("generated/"));

/** Source with whole-line comments dropped, so a note about Sales in a comment does not trip a name check. */
const withoutCommentLines = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

const DIALOG = "components/team/team-member-form-dialog.tsx";
const LAZY_DIALOG = "components/team/team-member-form-dialog-lazy.tsx";

// Where Sales code is allowed to live. Everything else is shared with people who have no Sales access.
const SALES_AREAS = ["components/sales/", "lib/sales/", "app/api/sales/", "app/(app)/sales/"];
const inSalesArea = (file: string) => SALES_AREAS.some((area) => file.startsWith(area));

const isClientFile = (source: string) => /^\s*["']use client["']/m.test(source.slice(0, 400));
const NAMES_SALES = /sales|\/deals/i;

/** A runtime (not type-only) import of the member dialog, in any spelling of the path. */
const STATIC_DIALOG_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+["'][^"']*team-member-form-dialog["']/m;

describe("guard: the member dialog is never a static import", () => {
  it("no file in src imports it as a value, apart from the lazy wrapper's dynamic import()", () => {
    const offenders = sourceFiles().filter((file) => file !== DIALOG && STATIC_DIALOG_IMPORT.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("the lazy wrapper is a client component that loads the dialog with import()", () => {
    const source = read(LAZY_DIALOG);
    expect(isClientFile(source)).toBe(true);
    expect(source).toMatch(/import\(\s*["']@\/components\/team\/team-member-form-dialog["']\s*\)/);
  });

  it("the Team page renders the lazy wrapper, in the admin-only Members tab", () => {
    const page = read("app/(app)/team/page.tsx");
    expect(page).toContain("@/components/team/team-member-form-dialog-lazy");
    const afterMembersTab = page.slice(page.indexOf("async function MembersTab"), page.indexOf("async function AvailabilityTab"));
    expect(afterMembersTab).toContain("<LazyTeamMemberFormDialog");
  });
});

describe("guard: no shared client code names Sales", () => {
  it("only the lazily loaded member dialog does, outside the Sales areas", () => {
    const naming = sourceFiles()
      .filter((file) => !inSalesArea(file))
      .filter((file) => isClientFile(read(file)))
      .filter((file) => NAMES_SALES.test(withoutCommentLines(read(file))));
    expect(naming).toEqual([DIALOG]);
  });

  it("the permission catalog (which labels the Sales switch) is imported by no client file but the dialog", () => {
    const importers = sourceFiles()
      .filter((file) => isClientFile(read(file)))
      .filter((file) => /from\s+["']@\/lib\/permission-catalog["']/.test(read(file)));
    expect(importers).toEqual([DIALOG]);
  });
});
