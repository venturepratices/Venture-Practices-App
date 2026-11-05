import fs from "node:fs";
import path from "node:path";

// Sales is secret from one team member. The page source of everything outside
// the Sales area must not name it, and that includes the scripts Next lists in
// a page's HTML: it turns every file in a page's `entryJSFiles` (its own client
// chunks plus its layouts') into a <script src>, whether or not that part of
// the page renders for the person. This reads a finished `next build` and looks
// for Sales words in exactly those scripts. It fails closed: anything it cannot
// read or recognise is reported as a problem, never skipped.

/** What counts as naming Sales: the word itself (which also covers canUseSales and salesSeesAllDeals) and the /deals path. */
const SALES_WORDS = /sales|\/deals/gi;
const MANIFEST_NAME = "page_client-reference-manifest.js";
const MAX_SAMPLES = 3;

export type SalesWordFinding = { route: string; file: string; samples: string[] };
export type SalesScanResult = {
  /** Pages outside the Sales area whose scripts were checked. */
  pagesScanned: number;
  /** A script a non-Sales page loads that names Sales. */
  findings: SalesWordFinding[];
  /** Things the scan could not check (treat as a failure). */
  problems: string[];
};

/** The Sales area's own pages may name Sales: (app)/sales and anything below it. */
const isSalesRoute = (route: string) => /(^|\/)sales(\/|$)/.test(route);

function manifestFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...manifestFiles(full));
    else if (entry.name === MANIFEST_NAME) found.push(full);
  }
  return found;
}

/** The manifest is `globalThis.__RSC_MANIFEST["/route/page"] = {json};` so everything after `] = ` is one JSON object. */
function readEntryScripts(manifestPath: string): string[] | string {
  const text = fs.readFileSync(manifestPath, "utf8");
  const start = text.indexOf("] = {");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return "its manifest is not in the expected shape";
  let manifest: { entryJSFiles?: Record<string, string[]> };
  try {
    manifest = JSON.parse(text.slice(start + 4, end + 1));
  } catch {
    return "its manifest is not in the expected shape";
  }
  if (!manifest.entryJSFiles || typeof manifest.entryJSFiles !== "object") return "its manifest has no entryJSFiles";
  return [...new Set(Object.values(manifest.entryJSFiles).flat())];
}

export function scanBuildForSalesWords(nextDir: string): SalesScanResult {
  const appDir = path.join(nextDir, "server", "app");
  const manifests = manifestFiles(appDir);
  const result: SalesScanResult = { pagesScanned: 0, findings: [], problems: [] };
  if (manifests.length === 0) {
    result.problems.push(`no page manifests found under ${appDir} (not found, or not a finished next build)`);
    return result;
  }

  // One read per script: layouts' scripts are shared by dozens of pages.
  const scriptCache = new Map<string, { samples: string[] } | { error: string }>();
  const checkScript = (file: string) => {
    let checked = scriptCache.get(file);
    if (!checked) {
      try {
        const source = fs.readFileSync(path.join(nextDir, ...file.split("/")), "utf8");
        const samples = new Set<string>();
        for (const match of source.matchAll(SALES_WORDS)) {
          samples.add(source.slice(Math.max(0, match.index - 25), match.index + 45).replace(/\s+/g, " "));
          if (samples.size >= MAX_SAMPLES) break;
        }
        checked = { samples: [...samples] };
      } catch {
        checked = { error: "cannot be read" };
      }
      scriptCache.set(file, checked);
    }
    return checked;
  };

  for (const manifestPath of manifests) {
    const route = path.relative(appDir, path.dirname(manifestPath)).split(path.sep).join("/");
    if (isSalesRoute(route)) continue;
    result.pagesScanned++;

    const scripts = readEntryScripts(manifestPath);
    if (typeof scripts === "string") {
      result.problems.push(`${route || "(root)"}: ${scripts}`);
      continue;
    }
    for (const file of scripts) {
      const checked = checkScript(file);
      if ("error" in checked) result.problems.push(`${route || "(root)"}: script ${file} ${checked.error}`);
      else if (checked.samples.length > 0) result.findings.push({ route: route || "(root)", file, samples: checked.samples });
    }
  }
  return result;
}
