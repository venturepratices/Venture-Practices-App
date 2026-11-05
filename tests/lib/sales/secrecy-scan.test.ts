import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanBuildForSalesWords } from "../../../scripts/lib/sales-secrecy-scan";

// The scanner reads a finished `next build` (the .next folder): for every page
// outside the Sales area it opens the page's client-reference manifest, takes
// the scripts the build lists for that page and its layouts (the ones Next puts
// in the page's HTML as <script src>), and looks for Sales words in them.
// These tests build a tiny fake .next folder, so they need no real build.

let nextDir: string;

beforeEach(() => {
  nextDir = fs.mkdtempSync(path.join(os.tmpdir(), "sales-secrecy-"));
});
afterEach(() => {
  fs.rmSync(nextDir, { recursive: true, force: true });
});

function writeChunk(file: string, contents: string) {
  const full = path.join(nextDir, ...file.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

/** Same shape Next 16 writes: a globalThis assignment of one JSON object that has an entryJSFiles map. */
function writePage(route: string, entryJSFiles: Record<string, string[]> | null) {
  const body = {
    moduleLoading: { prefix: "", crossOrigin: null },
    clientModules: { "[project]/some/module.js": { id: 1, name: "*", chunks: ["static/chunks/x.js"] } },
    ...(entryJSFiles ? { entryJSFiles } : {}),
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
    writePage("(app)/clients", {
      "[project]/src/app/(app)/layout": ["static/chunks/layout.js"],
      "[project]/src/app/(app)/clients/page": ["static/chunks/clients.js"],
    });

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
