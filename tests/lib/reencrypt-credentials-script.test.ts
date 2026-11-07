import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

// Review of audit row 18: scripts/reencrypt-credentials.ts used to start with
// `import "dotenv/config"`, so a key the terminal did not set was quietly
// filled in from the laptop .env, which may hold a different key from
// production's. The script now keeps a copy of the environment as the terminal
// set it before .env is loaded (scripts/reencrypt-credentials-env.ts) and
// refuses keys that did not come from the terminal. These tests check that
// copy is taken first, and that the script is wired to use it.

const FROM_FILE = "REENCRYPT_TEST_FROM_DOTENV";
const FROM_TERMINAL = "REENCRYPT_TEST_FROM_TERMINAL";

vi.mock("dotenv", () => {
  const config = vi.fn(() => {
    process.env[FROM_FILE] = "from .env";
    return { parsed: { [FROM_FILE]: "from .env" } };
  });
  return { config, default: { config } };
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env[FROM_FILE];
});

describe("scripts/reencrypt-credentials-env.ts", () => {
  it("keeps the terminal's environment from before .env is loaded, then loads .env", async () => {
    vi.stubEnv(FROM_TERMINAL, "typed in the terminal");
    vi.resetModules();
    const { terminalEnv } = await import("../../scripts/reencrypt-credentials-env");

    expect(terminalEnv[FROM_TERMINAL]).toBe("typed in the terminal");
    expect(terminalEnv[FROM_FILE]).toBeUndefined();
    // .env still fills the rest (DATABASE_URL, for one) for the script.
    expect(process.env[FROM_FILE]).toBe("from .env");
  });
});

const SCRIPT = join(process.cwd(), "scripts", "reencrypt-credentials.ts");

function parseScript(): ts.SourceFile {
  return ts.createSourceFile(SCRIPT, readFileSync(SCRIPT, "utf8"), ts.ScriptTarget.Latest, true);
}

/** Start offset of each call to a plain function name, in source order. */
function callPositions(source: ts.SourceFile, name: string): number[] {
  const found: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      found.push(node.getStart(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("scripts/reencrypt-credentials.ts wiring", () => {
  it("imports the terminal snapshot before anything else, and never dotenv itself", () => {
    const source = parseScript();
    const imports = source.statements
      .filter(ts.isImportDeclaration)
      .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text);

    expect(imports[0]).toBe("./reencrypt-credentials-env");
    expect(imports.filter((name) => name === "dotenv" || name.startsWith("dotenv/"))).toEqual([]);
  });

  it("checks the keys came from the terminal before using them", () => {
    const source = parseScript();
    const check = callPositions(source, "requireKeysFromTerminal");
    const firstUse = Math.min(...callPositions(source, "currentKeyDeps"), ...callPositions(source, "readKeyIds"));

    expect(check).toHaveLength(1);
    expect(check[0]).toBeLessThan(firstUse);
    const call = source.text.slice(check[0]).split(")")[0];
    expect(call.replace(/\s/g, "")).toBe("requireKeysFromTerminal(terminalEnv,process.env");
  });

  it("confirms the app saves with the terminal's current key before any table is read or written", () => {
    const source = parseScript();
    const confirm = callPositions(source, "confirmAppUsesCurrentKey");
    const firstTable = Math.min(...callPositions(source, "runTable"));

    expect(confirm).toHaveLength(1);
    expect(confirm[0]).toBeLessThan(firstTable);
  });
});
