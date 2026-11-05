import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanBuildForSalesWords } from "../../../scripts/lib/sales-secrecy-scan";

// The scanner reads a finished `next build` (the .next folder). It checks the
// scripts Next puts on every page (build-manifest.json: the bootstrap
// rootMainFiles, any rootMainFilesTree list, and the polyfills), then, for every
// page outside the Sales area, the scripts and stylesheets its client-reference
// manifest lists for that page and its layouts. It looks for Sales words in all
// of them. These tests build a tiny fake .next folder, so they need no real build.

let nextDir: string;

beforeEach(() => {
  nextDir = fs.mkdtempSync(path.join(os.tmpdir(), "sales-secrecy-"));
  // Every real build has these; tests that are about them overwrite them.
  writeChunk("static/chunks/main.js", "bootstrap()");
  writeChunk("static/chunks/polyfill.js", "polyfill()");
  writeBuildManifest({ rootMainFiles: ["static/chunks/main.js"], polyfillFiles: ["static/chunks/polyfill.js"] });
});
afterEach(() => {
  fs.rmSync(nextDir, { recursive: true, force: true });
});

function writeChunk(file: string, contents: string) {
  const full = path.join(nextDir, ...file.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

/** Same shape Next 16 writes to .next/build-manifest.json (pages, devFiles and lowPriorityFiles left out: App Router pages do not load them). */
function writeBuildManifest(manifest: Record<string, unknown> | string) {
  fs.writeFileSync(
    path.join(nextDir, "build-manifest.json"),
    typeof manifest === "string" ? manifest : JSON.stringify({ pages: { "/_app": [] }, ...manifest }),
  );
}

type CssResource = { path: string; inlined: false } | { path: string; inlined: true; content: string };

/** Same shape Next 16 writes: a globalThis assignment of one JSON object that has entryJSFiles and entryCSSFiles maps. */
function writePage(
  route: string,
  entryJSFiles: Record<string, string[]> | null,
  entryCSSFiles: Record<string, CssResource[]> | null = {},
) {
  const body = {
    moduleLoading: { prefix: "", crossOrigin: null },
    clientModules: { "[project]/some/module.js": { id: 1, name: "*", chunks: ["static/chunks/x.js"] } },
    ...(entryJSFiles ? { entryJSFiles } : {}),
    ...(entryCSSFiles ? { entryCSSFiles } : {}),
  };
  const dir = path.join(nextDir, "server", "app", ...route.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "page_client-reference-manifest.js"),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/${route}/page"] = ${JSON.stringify(body)};\n`,
  );
}

describe("scanBuildForSalesWords", () => {
  it("passes a build whose non-Sales pages ship no Sales words", () => {
    writeChunk("static/chunks/layout.js", "export const nav=[{label:'Clients'}]");
    writeChunk("static/chunks/clients.js", "console.log('clients page')");
    writeChunk("static/chunks/app.css", ".card{padding:1rem}");
    writePage(
      "(app)/clients",
      {
        "[project]/src/app/(app)/layout": ["static/chunks/layout.js"],
        "[project]/src/app/(app)/clients/page": ["static/chunks/clients.js"],
      },
      { "[project]/src/app/layout": [{ path: "static/chunks/app.css", inlined: false }] },
    );

    const result = scanBuildForSalesWords(nextDir);

    expect(result.pagesScanned).toBe(1);
    expect(result.findings).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  it("reports the page, the script and the words when a non-Sales page ships a Sales script", () => {
    writeChunk("static/chunks/layout.js", "console.log('layout')");
    writeChunk("static/chunks/dialog.js", `{title:"Sales",items:[{key:"canUseSales",label:"Sales (deals, leads, activities)"}]}`);
    writePage("(app)/team", {
      "[project]/src/app/(app)/layout": ["static/chunks/layout.js"],
      "[project]/src/app/(app)/team/page": ["static/chunks/dialog.js"],
    });

    const result = scanBuildForSalesWords(nextDir);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].route).toBe("(app)/team");
    expect(result.findings[0].file).toBe("static/chunks/dialog.js");
    expect(result.findings[0].samples.join(" ")).toContain("canUseSales");
  });

  it("finds a Sales word that arrives through a shared layout script", () => {
    writeChunk("static/chunks/layout.js", "var nav='/sales/deals'");
    writePage("(app)/dashboard", { "[project]/src/app/(app)/layout": ["static/chunks/layout.js"] });

    expect(scanBuildForSalesWords(nextDir).findings.map((f) => f.route)).toEqual(["(app)/dashboard"]);
  });

  it("does not look at pages inside the Sales area, which are allowed to name Sales", () => {
    writeChunk("static/chunks/board.js", "label:'Sales deals board'");
    writePage("(app)/sales/deals", { "[project]/src/app/(app)/sales/deals/page": ["static/chunks/board.js"] });
    writeChunk("static/chunks/ok.js", "ok");
    writePage("(app)/clients", { "[project]/src/app/(app)/clients/page": ["static/chunks/ok.js"] });

    const result = scanBuildForSalesWords(nextDir);

    expect(result.pagesScanned).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it("still scans a page that merely has sales in its folder name", () => {
    writeChunk("static/chunks/hist.js", "var x='Sales history'");
    writePage("(app)/sales-history", { "[project]/src/app/(app)/sales-history/page": ["static/chunks/hist.js"] });

    expect(scanBuildForSalesWords(nextDir).findings.map((f) => f.route)).toEqual(["(app)/sales-history"]);
  });

  it("fails closed: no manifests at all is a problem, not a pass", () => {
    fs.mkdirSync(path.join(nextDir, "server", "app"), { recursive: true });
    const result = scanBuildForSalesWords(nextDir);
    expect(result.pagesScanned).toBe(0);
    expect(result.problems.join(" ")).toMatch(/no page manifests/i);
  });

  it("fails closed: a missing build folder is a problem", () => {
    const result = scanBuildForSalesWords(path.join(nextDir, "does-not-exist"));
    expect(result.problems.join(" ")).toMatch(/no page manifests|not found/i);
  });

  it("fails closed: a manifest with no entryJSFiles is a problem", () => {
    writePage("(app)/clients", null);
    const result = scanBuildForSalesWords(nextDir);
    expect(result.problems.join(" ")).toContain("(app)/clients");
    expect(result.problems.join(" ")).toMatch(/entryJSFiles/);
  });

  it("fails closed: a listed script that cannot be read is a problem", () => {
    writePage("(app)/clients", { "[project]/src/app/(app)/clients/page": ["static/chunks/missing.js"] });
    const result = scanBuildForSalesWords(nextDir);
    expect(result.problems.join(" ")).toContain("static/chunks/missing.js");
  });
});

describe("scanBuildForSalesWords: the scripts Next puts on every page", () => {
  // Next makes the first rootMainFiles entry the page's bootstrap <script> and
  // preloads the rest, on every App Router page (/login included), from
  // build-manifest.json, not from the page's own manifest. Sentry's route list
  // is injected into one of them.
  const cleanPage = () => {
    writeChunk("static/chunks/ok.js", "ok");
    writePage("(auth)/login", { "[project]/src/app/(auth)/login/page": ["static/chunks/ok.js"] });
  };

  it("finds a Sales route in a bootstrap script and reports it once, for every page", () => {
    cleanPage();
    writePage("(app)/dashboard", { "[project]/src/app/(app)/dashboard/page": ["static/chunks/ok.js"] });
    writeChunk("static/chunks/sentry.js", 'staticRoutes:[{"path":"/rocks"},{"path":"/sales/deals"}]');
    writeBuildManifest({
      rootMainFiles: ["static/chunks/main.js", "static/chunks/sentry.js"],
      polyfillFiles: ["static/chunks/polyfill.js"],
    });

    const result = scanBuildForSalesWords(nextDir);

    expect(result.problems).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].route).toBe("(every page)");
    expect(result.findings[0].file).toBe("static/chunks/sentry.js");
    expect(result.findings[0].samples.join(" ")).toContain("/sales/deals");
  });

  it("finds a Sales word in a rootMainFilesTree list", () => {
    cleanPage();
    writeChunk("static/chunks/tree.js", "var label='Sales'");
    writeBuildManifest({
      rootMainFiles: ["static/chunks/main.js"],
      rootMainFilesTree: { "/(auth)/login/page": ["static/chunks/main.js", "static/chunks/tree.js"] },
      polyfillFiles: ["static/chunks/polyfill.js"],
    });

    expect(scanBuildForSalesWords(nextDir).findings.map((f) => f.file)).toEqual(["static/chunks/tree.js"]);
  });

  it("finds a Sales word in a polyfill script", () => {
    cleanPage();
    writeChunk("static/chunks/polyfill.js", "var p='/deals'");

    expect(scanBuildForSalesWords(nextDir).findings.map((f) => f.file)).toEqual(["static/chunks/polyfill.js"]);
  });

  it("fails closed: a missing build-manifest.json is a problem", () => {
    cleanPage();
    fs.rmSync(path.join(nextDir, "build-manifest.json"));

    expect(scanBuildForSalesWords(nextDir).problems.join(" ")).toMatch(/build-manifest\.json/);
  });

  it("fails closed: a build-manifest.json that does not parse is a problem", () => {
    cleanPage();
    writeBuildManifest("{ not json");

    expect(scanBuildForSalesWords(nextDir).problems.join(" ")).toMatch(/build-manifest\.json/);
  });

  it("fails closed: a build-manifest.json without rootMainFiles or polyfillFiles is a problem", () => {
    cleanPage();
    writeBuildManifest({ polyfillFiles: [] });
    expect(scanBuildForSalesWords(nextDir).problems.join(" ")).toMatch(/rootMainFiles/);

    writeBuildManifest({ rootMainFiles: ["static/chunks/main.js"] });
    expect(scanBuildForSalesWords(nextDir).problems.join(" ")).toMatch(/polyfillFiles/);
  });

  it("fails closed: a bootstrap script that cannot be read is a problem", () => {
    cleanPage();
    writeBuildManifest({ rootMainFiles: ["static/chunks/gone.js"], polyfillFiles: [] });

    expect(scanBuildForSalesWords(nextDir).problems.join(" ")).toContain("static/chunks/gone.js");
  });
});

describe("scanBuildForSalesWords: stylesheets", () => {
  it("finds a Sales class name in a page's stylesheet", () => {
    writeChunk("static/chunks/ok.js", "ok");
    writeChunk("static/chunks/app.css", ".sales-board{display:flex}");
    writePage(
      "(app)/clients",
      { "[project]/src/app/(app)/clients/page": ["static/chunks/ok.js"] },
      { "[project]/src/app/layout": [{ path: "static/chunks/app.css", inlined: false }] },
    );

    const result = scanBuildForSalesWords(nextDir);

    expect(result.findings.map((f) => [f.route, f.file])).toEqual([["(app)/clients", "static/chunks/app.css"]]);
  });

  it("checks the text of a stylesheet Next inlines into the page", () => {
    writeChunk("static/chunks/ok.js", "ok");
    writePage(
      "(app)/clients",
      { "[project]/src/app/(app)/clients/page": ["static/chunks/ok.js"] },
      { "[project]/src/app/layout": [{ path: "static/chunks/inline.css", inlined: true, content: ".sales-row{color:red}" }] },
    );

    expect(scanBuildForSalesWords(nextDir).findings.map((f) => f.file)).toEqual(["static/chunks/inline.css"]);
  });

  it("fails closed: a manifest with no entryCSSFiles is a problem", () => {
    writeChunk("static/chunks/ok.js", "ok");
    writePage("(app)/clients", { "[project]/src/app/(app)/clients/page": ["static/chunks/ok.js"] }, null);

    const problems = scanBuildForSalesWords(nextDir).problems.join(" ");
    expect(problems).toContain("(app)/clients");
    expect(problems).toMatch(/entryCSSFiles/);
  });
});
