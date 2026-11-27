import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// A cron route that catches its own error and just returns 500 fails silently:
// the only trace is a red line in Vercel's cron log and nobody is told. Every
// cron route with a catch must hand the error to Sentry, through
// reportCronFailure (src/lib/cron-failure.ts) or Sentry.captureException.
//
// A route that has a real reason to swallow an error can opt out by carrying
// this exact comment, with the reason after the colon:
//   // cron-failure-ok: <why this catch does not need to alert>

const ROOT = process.cwd();
const CRON_DIR = path.join(ROOT, "src", "app", "api", "cron");

const CATCH = /\bcatch\s*[({]/;
const REPORTS = /\breportCronFailure\(|\bSentry\.captureException\(/;
const OPT_OUT = /\/\/ cron-failure-ok: \S/;

/** Drops comments so a word like "catches" or a call written in a comment does not count. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** True when the route has a catch but neither reports the error nor opts out with a reason. */
function silentCatch(source: string): boolean {
  const code = withoutComments(source);
  if (!CATCH.test(code)) return false;
  if (OPT_OUT.test(source)) return false;
  return !REPORTS.test(code);
}

const cronRoutes = fs
  .readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry): [string, string] => [entry.name, path.join(CRON_DIR, entry.name, "route.ts")])
  .filter(([, file]) => fs.existsSync(file));

describe("guard: a cron route that catches an error must tell Sentry", () => {
  it("finds the cron routes (so the checks below are not passing on an empty list)", () => {
    expect(cronRoutes.length).toBeGreaterThanOrEqual(14);
  });

  it.each(cronRoutes)("src/app/api/cron/%s/route.ts", (_name, file) => {
    const source = fs.readFileSync(file, "utf8");
    expect(
      silentCatch(source),
      "has a catch but never calls reportCronFailure( or Sentry.captureException(. " +
        "Report the error, or add `// cron-failure-ok: <reason>` if it is truly fine to swallow.",
    ).toBe(false);
  });

  it("the check flags a catch that only logs", () => {
    const source = `try { await job(); } catch (error) { console.error("failed", error); return fail(); }`;
    expect(silentCatch(source)).toBe(true);
  });

  it("the check flags a catch whose report is only mentioned in a comment", () => {
    const source = `try { await job(); } catch (error) {
      // TODO: await reportCronFailure("job", error)
      return fail();
    }`;
    expect(silentCatch(source)).toBe(true);
  });

  it("the check accepts either way of reporting", () => {
    expect(silentCatch(`try { a(); } catch (e) { await reportCronFailure("job", e); }`)).toBe(false);
    expect(silentCatch(`try { a(); } catch (e) { Sentry.captureException(e); }`)).toBe(false);
  });

  it("the check accepts an opt-out that gives a reason, and refuses one that gives none", () => {
    const withReason = `// cron-failure-ok: the next run retries and a failure is logged anyway\ntry { a(); } catch (e) { b(); }`;
    const withoutReason = `// cron-failure-ok:\ntry { a(); } catch (e) { b(); }`;
    expect(silentCatch(withReason)).toBe(false);
    expect(silentCatch(withoutReason)).toBe(true);
  });

  it("the check ignores the word catch in a comment and files with no catch at all", () => {
    expect(silentCatch(`// turning it back on later catches up on missed work\nawait job();`)).toBe(false);
    expect(silentCatch(`/* never throws past its own try/catch */\nawait job();`)).toBe(false);
  });
});
