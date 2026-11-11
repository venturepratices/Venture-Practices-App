import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for audit finding H1: rich-text HTML (task comments, client notes,
// meeting-note transcripts) must be cleaned by the shared sanitizer before it
// is saved, and RichTextContent must stay the only raw-HTML render.

const SRC = join(process.cwd(), "src");
const SANITIZER_IMPORT = /import\s*\{[^}]*\bsanitizeRichText\b[^}]*\}\s*from\s*["']@\/lib\/rich-text-sanitize["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((full) => ({
  path: relative(process.cwd(), full).split(sep).join("/"),
  text: readFileSync(full, "utf8"),
}));

// Any direct or nested Prisma write to the three rich-text models.
const RICH_TEXT_WRITE =
  /\b(?:comment|clientNote|meetingNote)\.(?:create|createMany|createManyAndReturn|update|updateMany|upsert)\s*\(|\b(?:comments|clientNotes|meetingNotes)\s*:\s*\{\s*(?:create|createMany|update|updateMany|upsert)\b/;

const writers = files.filter((file) => RICH_TEXT_WRITE.test(file.text));

describe("rich-text sanitizer guard", () => {
  it("finds the known rich-text write paths (so the scan itself is not broken)", () => {
    const paths = writers.map((file) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "src/app/api/tasks/[taskId]/comments/route.ts",
        "src/app/api/clients/[clientId]/notes/route.ts",
        "src/app/api/clients/[clientId]/notes/[noteId]/route.ts",
        "src/app/api/clients/[clientId]/meetings/route.ts",
      ])
    );
  });

  it.each(writers.map((file) => [file.path, file.text]))("%s imports and calls sanitizeRichText", (_path, text) => {
    expect(text).toMatch(SANITIZER_IMPORT);
    // Imported AND used: at least one mention beyond the import line.
    expect(text.match(/\bsanitizeRichText\b/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it("RichTextContent cleans its HTML with the shared sanitizer", () => {
    const component = files.find((file) => file.path === "src/components/ui/rich-text-content.tsx");
    expect(component?.text).toMatch(SANITIZER_IMPORT);
    expect(component?.text).toMatch(/__html:\s*sanitizeRichText\(/);
  });

  it("no other file renders raw HTML", () => {
    const rawRenderers = files.filter((file) => /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/.test(file.text));
    expect(rawRenderers.map((file) => file.path)).toEqual(["src/components/ui/rich-text-content.tsx"]);
  });
});
