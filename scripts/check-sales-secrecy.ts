import path from "node:path";

import { scanBuildForSalesWords } from "./lib/sales-secrecy-scan";

// Proves no page outside the Sales area sends the browser a script that names
// Sales. Run it after a build, from the project root:
//   npm run build:ci   (or `npx next build`)
//   npm run check:sales-secrecy
// Exits 1 on any hit, and also when it could not check something.
const nextDir = path.resolve(process.argv[2] ?? ".next");
const { pagesScanned, findings, problems } = scanBuildForSalesWords(nextDir);

const byScript = new Map<string, { routes: string[]; samples: string[] }>();
for (const finding of findings) {
  const entry = byScript.get(finding.file) ?? { routes: [], samples: finding.samples };
  entry.routes.push(finding.route);
  byScript.set(finding.file, entry);
}
for (const [file, { routes, samples }] of byScript) {
  console.error(`LEAK  ${file} is loaded by: ${routes.join(", ")}`);
  for (const sample of samples) console.error(`        ...${sample}...`);
}
for (const problem of problems) console.error(`COULD NOT CHECK  ${problem}`);

if (findings.length > 0 || problems.length > 0) {
  console.error(`\nFAILED: ${findings.length} leaking script load(s), ${problems.length} problem(s), ${pagesScanned} page(s) scanned.`);
  process.exit(1);
}
console.log(`OK: ${pagesScanned} pages outside the Sales area, none loads a script that names Sales.`);
