import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for audit row 41 (old #15): a secret kept in an env var
// (process.env.<...SECRET...> or <...TOKEN...>) must never be compared with
// ===, !==, == or !=. Those stop at the first differing character, which can
// leak the secret a little at a time, and they make it easy to forget the
// "secret not set" case. Use checkBearer / safeEqualSecret from
// src/lib/secret-compare.ts instead (constant time, fails closed).
//
// For a presence check write `!secret`, not `secret === undefined`.

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const ENV_SECRET = String.raw`process\.env(?:\.|\[\s*["'\x60])[A-Z0-9_]*(?:SECRET|TOKEN)[A-Z0-9_]*`;
// A whole ==, ===, != or !== (never the tail of a longer operator).
const EQUALITY = String.raw`(?<![!=<>])[!=]==?(?!=)`;
const IDENT = String.raw`[A-Za-z_$][\w$]*`;
// The other side of a plain presence check, which is not a secret compare.
const LITERAL_RIGHT = String.raw`(?!\s*(?:(?:undefined|null)\b|""|''|\x60\x60))`;
const LITERAL_LEFT = String.raw`(?<!(?:\bundefined|\bnull|""|''|\x60\x60)\s*)`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Local names that hold a secret env value: `const x = process.env.FOO_SECRET`, `const { FOO_TOKEN: x } = process.env`. */
function secretBindings(source: string): string[] {
  const names = new Set<string>();
  const direct = new RegExp(String.raw`\b(?:const|let|var)\s+(${IDENT})\s*(?::[^=;]+)?=\s*${ENV_SECRET}`, "g");
  for (const match of source.matchAll(direct)) names.add(match[1]);

  const destructured = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env\b/g;
  for (const match of source.matchAll(destructured)) {
    for (const part of match[1].split(",")) {
      const [key, alias] = part.split("=")[0].split(":").map((piece) => piece.trim());
      if (key && /SECRET|TOKEN/.test(key)) names.add(alias || key);
    }
  }
  return [...names];
}

/** Every `secret === x` / `x !== \`Bearer ${secret}\`` style compare in a source file. */
function secretEqualityCompares(source: string): string[] {
  const names = secretBindings(source).map(escapeRegExp);
  const secretRef = names.length > 0 ? `(?:${ENV_SECRET}|(?<![\\w$.])(?<!typeof\\s+)(?:${names.join("|")})(?![\\w$]))` : ENV_SECRET;
  const operand = String.raw`(?:${secretRef}|\x60[^\x60]*\$\{\s*${secretRef}\s*\}[^\x60]*\x60)`;
  const leftSide = new RegExp(String.raw`${operand}\s*${EQUALITY}${LITERAL_RIGHT}`, "g");
  const rightSide = new RegExp(String.raw`${LITERAL_LEFT}${EQUALITY}\s*${operand}`, "g");
  return [...source.matchAll(leftSide), ...source.matchAll(rightSide)].map((match) => match[0]);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((full) => ({
  path: relative(ROOT, full).split(sep).join("/"),
  text: readFileSync(full, "utf8"),
}));

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

const CRON_DIR = join(SRC, "app", "api", "cron");
const cronRoutes = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(CRON_DIR, entry.name, "route.ts")))
  .map((entry) => `src/app/api/cron/${entry.name}/route.ts`);

const HELPER_IMPORT = /import\s*\{[^}]*\b(?:checkBearer|safeEqualSecret)\b[^}]*\}\s*from\s*["']@\/lib\/secret-compare["']/;

describe("secret compare scanner (self-check)", () => {
  it.each([
    [
      "the old cron gate",
      'const secret = process.env.CRON_SECRET;\nconst authHeader = request.headers.get("authorization");\nif (!secret || authHeader !== `Bearer ${secret}`) {}',
    ],
    ["the old MCP gate", "const expected = process.env.MCP_ACCESS_TOKEN;\nreturn Boolean(expected) && token === expected;"],
    ["env value on the right", 'if (request.headers.get("x-token") === process.env.FOO_TOKEN) {}'],
    ["env value on the left, loose", "if (process.env.WEBHOOK_SECRET != provided) {}"],
    ["env value inside a template", "if (header === `Bearer ${process.env.CRON_SECRET}`) {}"],
    ["destructured env", "const { CRON_SECRET } = process.env;\nif (header == `Bearer ${CRON_SECRET}`) {}"],
    ["destructured and renamed", "const { AGENT_API_TOKEN: agentToken } = process.env;\nif (agentToken !== got) {}"],
    ["bracket access", 'const key = process.env["HOOK_SECRET"];\nif (key === sent) {}'],
  ])("flags %s", (_label, source) => {
    expect(secretEqualityCompares(source)).not.toEqual([]);
  });

  it.each([
    ["the shared bearer helper", "if (!checkBearer(request, process.env.CRON_SECRET)) {}"],
    ["the shared value helper", "return safeEqualSecret(token, process.env.MCP_ACCESS_TOKEN);"],
    ["a presence check", "if (!process.env.SLACK_BOT_TOKEN) return;"],
    ["a length check", "const token = process.env.SLACK_BOT_TOKEN;\nif (!token || token.length === 0) return;"],
    ["a typeof check", 'const secret = process.env.CRON_SECRET;\nif (typeof secret === "string") {}'],
    ["a compare with nothing", 'const secret = process.env.CRON_SECRET;\nif (secret === undefined || secret === "" || null == secret) {}'],
    ["a same-named property", "const token = process.env.SLACK_BOT_TOKEN;\nif (body.token === other) {}"],
    ["an unrelated compare", 'const secret = process.env.CRON_SECRET;\nif (status === "ok") {}'],
  ])("does not flag %s", (_label, source) => {
    expect(secretEqualityCompares(source)).toEqual([]);
  });
});

describe("secret compare guard", () => {
  it("scans the files that hold secret env values (so the scan is not empty)", () => {
    const readers = files.filter((file) => new RegExp(ENV_SECRET).test(file.text)).map((file) => file.path);
    expect(readers).toEqual(expect.arrayContaining([...cronRoutes, "src/app/api/mcp/[token]/route.ts", "src/lib/agent-auth.ts"]));
  });

  it("no file under src compares a secret env value with ===, !==, == or !=", () => {
    const offenders = files
      .map((file) => ({ path: file.path, compares: secretEqualityCompares(file.text) }))
      .filter((file) => file.compares.length > 0);
    expect(offenders).toEqual([]);
  });

  it("finds every cron route", () => {
    expect(cronRoutes).toEqual(
      expect.arrayContaining(
        [
          "asset-due-soon",
          "backup",
          "calendar-sync",
          "daily-briefing",
          "highlevel-prune",
          "notification-digest",
          "priority-auto-escalate",
          "rock-checkin",
          "storage-check",
          "task-due-soon",
        ].map((name) => `src/app/api/cron/${name}/route.ts`)
      )
    );
  });

  it.each(cronRoutes)("%s checks CRON_SECRET with checkBearer", (path) => {
    const text = read(path);
    expect(text).toMatch(HELPER_IMPORT);
    expect(text).toContain("checkBearer(request, process.env.CRON_SECRET)");
  });

  it("the agent API checks AGENT_API_TOKEN with checkBearer", () => {
    const text = read("src/lib/agent-auth.ts");
    expect(text).toMatch(HELPER_IMPORT);
    expect(text).toContain("checkBearer(request, process.env.AGENT_API_TOKEN)");
  });

  it("the MCP route checks MCP_ACCESS_TOKEN with safeEqualSecret", () => {
    const text = read("src/app/api/mcp/[token]/route.ts");
    expect(text).toMatch(HELPER_IMPORT);
    expect(text).toContain("safeEqualSecret(token, process.env.MCP_ACCESS_TOKEN)");
  });

  it("the helper hashes both sides and compares with timingSafeEqual", () => {
    const text = read("src/lib/secret-compare.ts");
    expect(text).toMatch(/createHash\(\s*["']sha256["']\s*\)/);
    expect(text).toMatch(/\btimingSafeEqual\(/);
  });
});
