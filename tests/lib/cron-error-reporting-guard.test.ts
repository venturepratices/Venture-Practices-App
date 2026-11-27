import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// A cron route that catches its own error and just returns 500 fails silently:
// the only trace is a red line in Vercel's cron log and nobody is told. So EVERY
// catch block in a cron route must hand the error to Sentry, through
// `await reportCronFailure(` (src/lib/cron-failure.ts) or `Sentry.captureException(`.
// Each catch is checked on its own: a second report elsewhere in the file does
// not cover a catch that forgot, and dropping the `await` (so the flush may not
// finish before the function ends) is caught too.
//
// A catch that has a real reason to swallow its error opts out with this exact
// comment, reason after the colon, either as the first thing inside the catch
// block or on the line just above the `} catch`:
//   // cron-failure-ok: <why this catch does not need to alert>
// The opt-out covers only the one catch it sits with.

const ROOT = process.cwd();
const CRON_DIR = path.join(ROOT, "src", "app", "api", "cron");

// `catch (e) {` / `catch {` (a catch block) or `.catch(` (a promise handler).
const CATCH = /\bcatch\b\s*(?:\([^)]*\))?\s*\{|\.catch\s*\(/g;
const REPORTS = /\bawait\s+reportCronFailure\(|\bSentry\.captureException\(/;
const OPT_OUT_COMMENT = "// cron-failure-ok: ";
const OPT_OUT_JUST_ABOVE = /\/\/ cron-failure-ok: \S[^\n]*\n\s*\}?\s*$/;
const OPT_OUT_FIRST_INSIDE = /^\s*\/\/ cron-failure-ok: \S/;

/** Blanks out comments but keeps every character position, so offsets still line up with the raw source. */
function maskComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return source.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/gm, (match, lead: string | undefined) =>
    lead === undefined ? blank(match) : lead + blank(match.slice(lead.length)),
  );
}

/** Index of the bracket that closes the one at `open`, or -1 when it never closes. */
function closingIndex(code: string, open: number): number {
  const opener = code[open];
  const closer = opener === "{" ? "}" : ")";
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === opener) depth++;
    else if (code[i] === closer && --depth === 0) return i;
  }
  return -1;
}

/** One message per catch that neither reports its error nor opts out. Empty means the file is fine. */
function silentCatches(source: string): string[] {
  const code = maskComments(source);
  const problems: string[] = [];
  for (const match of code.matchAll(CATCH)) {
    const open = match.index + match[0].length - 1;
    const close = closingIndex(code, open);
    const line = source.slice(0, match.index).split("\n").length;
    if (close === -1) {
      problems.push(`line ${line}: could not find the end of this catch, so it could not be checked`);
      continue;
    }
    if (REPORTS.test(code.slice(open, close + 1))) continue;
    const optedOut =
      OPT_OUT_JUST_ABOVE.test(source.slice(0, match.index)) || OPT_OUT_FIRST_INSIDE.test(source.slice(open + 1));
    if (optedOut) continue;
    problems.push(`line ${line}: this catch never calls "await reportCronFailure(" or "Sentry.captureException("`);
  }
  return problems;
}

const cronRoutes = fs
  .readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry): [string, string] => [entry.name, path.join(CRON_DIR, entry.name, "route.ts")])
  .filter(([, file]) => fs.existsSync(file));

describe("guard: every catch in a cron route must tell Sentry", () => {
  it("finds the cron routes (so the checks below are not passing on an empty list)", () => {
    expect(cronRoutes.length).toBeGreaterThanOrEqual(14);
  });

  it.each(cronRoutes)("src/app/api/cron/%s/route.ts", (_name, file) => {
    const problems = silentCatches(fs.readFileSync(file, "utf8"));
    expect(
      problems,
      `Report the error with \`await reportCronFailure("<job>", error)\`, or put \`${OPT_OUT_COMMENT}<reason>\` ` +
        "with the catch if it is truly fine to swallow.",
    ).toEqual([]);
  });
});

describe("guard: the check itself", () => {
  it("flags a catch that only logs", () => {
    const source = `try { await job(); } catch (error) { console.error("failed", error); return fail(); }`;
    expect(silentCatches(source)).toHaveLength(1);
  });

  it("accepts a catch that awaits reportCronFailure, or calls Sentry.captureException", () => {
    expect(silentCatches(`try { a(); } catch (e) { await reportCronFailure("job", e); }`)).toEqual([]);
    expect(silentCatches(`try { a(); } catch (e) { Sentry.captureException(e); }`)).toEqual([]);
  });

  it("flags a catch that calls reportCronFailure without await", () => {
    expect(silentCatches(`try { a(); } catch (e) { reportCronFailure("job", e); }`)).toHaveLength(1);
  });

  it("flags a catch whose report is only mentioned in a comment", () => {
    const source = `try { a(); } catch (e) {
      // TODO: await reportCronFailure("job", e)
      return fail();
    }`;
    expect(silentCatches(source)).toHaveLength(1);
  });

  it("checks each catch on its own: a report elsewhere in the file does not cover it", () => {
    // The shape of the backup route: the not-written branch reports inside the try, the catch must too.
    const source = `
      try {
        const written = await write();
        if (!written) {
          await reportCronFailure("backup", new Error("not written"));
          return fail();
        }
      } catch (error) {
        console.error("backup failed", error);
        return fail();
      }`;
    const problems = silentCatches(source);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("line 8");
  });

  it("flags only the catch that is missing its report when a file has two", () => {
    const source = `
      try { a(); } catch (e) { await reportCronFailure("one", e); }
      try { b(); } catch (e) { console.error(e); }`;
    const problems = silentCatches(source);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("line 3");
  });

  it("finds the report when it sits inside a nested block of the catch", () => {
    const source = `try { a(); } catch (e) { if (isReal(e)) { await reportCronFailure("job", e); } return fail(); }`;
    expect(silentCatches(source)).toEqual([]);
  });

  it("checks a promise .catch handler too", () => {
    expect(silentCatches(`job().catch((e) => { console.error(e); });`)).toHaveLength(1);
    expect(silentCatches(`job().catch((e) => Sentry.captureException(e));`)).toEqual([]);
  });

  it("accepts an opt-out that gives a reason, just above the catch or first inside it", () => {
    const above = `try {\n  a();\n  // cron-failure-ok: the next run retries and the failure is logged anyway\n} catch (e) {\n  b();\n}`;
    const inside = `try { a(); } catch (e) {\n  // cron-failure-ok: the next run retries and the failure is logged anyway\n  b();\n}`;
    expect(silentCatches(above)).toEqual([]);
    expect(silentCatches(inside)).toEqual([]);
  });

  it("refuses an opt-out that gives no reason", () => {
    const source = `try { a(); } catch (e) {\n  // cron-failure-ok:\n  b();\n}`;
    expect(silentCatches(source)).toHaveLength(1);
  });

  it("an opt-out covers only the catch it sits with", () => {
    const source = `
      try { a(); } catch (e) {
        // cron-failure-ok: harmless, the next run repeats it
        b();
      }
      try { c(); } catch (e) { d(); }`;
    const problems = silentCatches(source);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("line 6");
  });

  it("ignores the word catch in comments and files with no catch at all", () => {
    expect(silentCatches(`// turning it back on later catches up on missed work\nawait job();`)).toEqual([]);
    expect(silentCatches(`/* never throws past its own try/catch (a) { */\nawait job();`)).toEqual([]);
  });
});
