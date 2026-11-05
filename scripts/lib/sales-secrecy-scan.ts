import fs from "node:fs";
import path from "node:path";

// Sales is secret from one team member. The page source of everything outside
// the Sales area must not name it, and that includes every file the page makes
// the browser load. For an App Router page in Next 16.2.12 that is:
//   - the scripts Next puts on EVERY page, from .next/build-manifest.json:
//     `rootMainFiles` (or the page's `rootMainFilesTree` list: the first file is
//     the bootstrap <script>, the rest are preloaded) and the `polyfillFiles`
//     (server/app-render/required-scripts.js and app-render.js);
//   - the page's own `entryJSFiles` (its client chunks plus its layouts'), each
//     a <script src> whether or not that part of the page renders for the
//     person (server/app-render/create-component-styles-and-scripts.js);
//   - the page's `entryCSSFiles`, linked or inlined as <style>.
// This reads a finished `next build` and looks for Sales words in all of those.
// It does not read the HTML itself (the server renders that per person). It
// fails closed: anything it cannot read or recognise is reported as a problem,
// never skipped.

/** What counts as naming Sales: the word itself (which also covers canUseSales and salesSeesAllDeals) and the /deals path. */
const SALES_WORDS = /sales|\/deals/gi;
const MANIFEST_NAME = "page_client-reference-manifest.js";
const MAX_SAMPLES = 3;
/** The route a finding is reported under when the file is one Next puts on every page. */
export const EVERY_PAGE = "(every page)";

export type SalesWordFinding = { route: string; file: string; samples: string[] };
export type SalesScanResult = {
  /** Pages outside the Sales area whose files were checked. */
  pagesScanned: number;
  /** A file a non-Sales page (or every page) loads that names Sales. */
  findings: SalesWordFinding[];
  /** Things the scan could not check (treat as a failure). */
  problems: string[];
};

/** The Sales area's own pages may name Sales: (app)/sales and anything below it. */
const isSalesRoute = (route: string) => /(^|\/)sales(\/|$)/.test(route);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

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

/** The scripts every page loads, from build-manifest.json; a string is why they could not be read. */
function readEveryPageScripts(nextDir: string): string[] | string {
  let manifest: { rootMainFiles?: unknown; rootMainFilesTree?: unknown; polyfillFiles?: unknown };
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"));
  } catch {
    return "build-manifest.json is missing or does not parse, so the scripts every page loads were not checked";
  }
  const { rootMainFiles, rootMainFilesTree, polyfillFiles } = manifest;
  // Next throws "missing bootstrap script" on an empty list, so empty is as unexpected as absent.
  if (!isStringList(rootMainFiles) || rootMainFiles.length === 0) return "build-manifest.json has no rootMainFiles list";
  if (!isStringList(polyfillFiles)) return "build-manifest.json has no polyfillFiles list";
  const files = [...rootMainFiles, ...polyfillFiles];
  if (rootMainFilesTree !== undefined) {
    const lists = rootMainFilesTree && typeof rootMainFilesTree === "object" ? Object.values(rootMainFilesTree) : null;
    if (!lists || !lists.every(isStringList)) return "build-manifest.json has a rootMainFilesTree that is not lists of files";
    files.push(...lists.flat());
  }
  return [...new Set(files)];
}

type PageFile = { file: string; inlinedText?: string };

/** The manifest is `globalThis.__RSC_MANIFEST["/route/page"] = {json};` so everything after `] = ` is one JSON object. */
function readPageFiles(manifestPath: string): PageFile[] | string {
  const text = fs.readFileSync(manifestPath, "utf8");
  const start = text.indexOf("] = {");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return "its manifest is not in the expected shape";
  let manifest: { entryJSFiles?: unknown; entryCSSFiles?: unknown };
  try {
    manifest = JSON.parse(text.slice(start + 4, end + 1));
  } catch {
    return "its manifest is not in the expected shape";
  }
  const { entryJSFiles, entryCSSFiles } = manifest;
  if (!entryJSFiles || typeof entryJSFiles !== "object") return "its manifest has no entryJSFiles";
  if (!entryCSSFiles || typeof entryCSSFiles !== "object") return "its manifest has no entryCSSFiles";

  const scriptLists = Object.values(entryJSFiles);
  if (!scriptLists.every(isStringList)) return "its manifest has entryJSFiles that are not lists of files";
  const files: PageFile[] = scriptLists.flat().map((file) => ({ file }));

  for (const list of Object.values(entryCSSFiles)) {
    if (!Array.isArray(list)) return "its manifest has entryCSSFiles that are not lists";
    for (const css of list as Array<{ path?: unknown; inlined?: unknown; content?: unknown }>) {
      if (!css || typeof css.path !== "string") return "its manifest has an entryCSSFiles item with no path";
      if (css.inlined === true) {
        if (typeof css.content !== "string") return `its manifest inlines ${css.path} with no content`;
        files.push({ file: css.path, inlinedText: css.content });
      } else files.push({ file: css.path });
    }
  }
  return files;
}

function salesSamples(source: string): string[] {
  const samples = new Set<string>();
  for (const match of source.matchAll(SALES_WORDS)) {
    samples.add(source.slice(Math.max(0, match.index - 25), match.index + 45).replace(/\s+/g, " "));
    if (samples.size >= MAX_SAMPLES) break;
  }
  return [...samples];
}

export function scanBuildForSalesWords(nextDir: string): SalesScanResult {
  const result: SalesScanResult = { pagesScanned: 0, findings: [], problems: [] };

  // One read per file: the bootstrap scripts and layouts' files are shared by dozens of pages.
  const fileCache = new Map<string, { samples: string[] } | { error: string }>();
  const checkFile = ({ file, inlinedText }: PageFile, route: string) => {
    let checked = inlinedText === undefined ? fileCache.get(file) : undefined;
    if (!checked) {
      try {
        checked = { samples: salesSamples(inlinedText ?? fs.readFileSync(path.join(nextDir, ...file.split("/")), "utf8")) };
      } catch {
        checked = { error: "cannot be read" };
      }
      if (inlinedText === undefined) fileCache.set(file, checked);
    }
    if ("error" in checked) result.problems.push(`${route}: ${file} ${checked.error}`);
    else if (checked.samples.length > 0) result.findings.push({ route, file, samples: checked.samples });
  };

  // 1. What Next puts on every page, the login page included. Reported once, not per page.
  const everyPage = readEveryPageScripts(nextDir);
  if (typeof everyPage === "string") result.problems.push(everyPage);
  else for (const file of everyPage) checkFile({ file }, EVERY_PAGE);

  // 2. Each page outside the Sales area: its own scripts and stylesheets, and its layouts'.
  const appDir = path.join(nextDir, "server", "app");
  const manifests = manifestFiles(appDir);
  if (manifests.length === 0) {
    result.problems.push(`no page manifests found under ${appDir} (not found, or not a finished next build)`);
    return result;
  }
  for (const manifestPath of manifests) {
    const route = path.relative(appDir, path.dirname(manifestPath)).split(path.sep).join("/") || "(root)";
    if (isSalesRoute(route)) continue;
    result.pagesScanned++;

    const files = readPageFiles(manifestPath);
    if (typeof files === "string") {
      result.problems.push(`${route}: ${files}`);
      continue;
    }
    const seen = new Set<string>();
    for (const pageFile of files) {
      if (seen.has(pageFile.file)) continue;
      seen.add(pageFile.file);
      checkFile(pageFile, route);
    }
  }
  return result;
}
