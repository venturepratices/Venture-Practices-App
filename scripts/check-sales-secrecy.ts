import path from "node:path";

import { scanBuildForSalesWords } from "./lib/sales-secrecy-scan";

// Proves that no file the browser is told to load outside the Sales area names
// Sales: the scripts Next puts on every page (bootstrap and polyfills, from
// build-manifest.json) and each non-Sales page's own scripts and stylesheets.
// It reads build output only, not rendered HTML. Run it after a build, from the
// project root:
//   npm run build:ci   (or `npx next build`)
//   npm run check:sales-secrecy
// Exits 1 on any hit, and also when it could not check something.
const nextDir = path.resolve(process.argv[2] ?? ".next");
const { pagesScanned, findings, problems } = scanBuildForSalesWords(nextDir);

const byFile = new Map<string, { routes: string[]; samples: string[] }>();
for (const finding of findings) {
  const entry = byFile.get(finding.file) ?? { routes: [], samples: finding.samples };
  entry.routes.push(finding.route);
  byFile.set(finding.file, entry);
}
for (const [file, { routes, samples }] of byFile) {
  console.error(`LEAK  ${file} is loaded by: ${routes.join(", ")}`);
  for (const sample of samples) console.error(`        ...${sample}...`);
}
for (const problem of problems) console.error(`COULD NOT CHECK  ${problem}`);

if (findings.length > 0 || problems.length > 0) {
  console.error(`\nFAILED: ${byFile.size} file(s) naming Sales, ${problems.length} problem(s), ${pagesScanned} page(s) scanned.`);
  process.exit(1);
}
console.log(
  `OK: the scripts every page loads, and the scripts and stylesheets of ${pagesScanned} pages outside the Sales area, name no Sales.`,
);
