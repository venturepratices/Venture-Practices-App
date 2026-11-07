import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Guard for audit M1 (summary row 12). src/proxy.ts leaves /api out of its
// matcher, so no login wall stands in front of the API: every route file has
// to check who is calling by itself, and a new route that forgets is open to
// the whole internet.
//
// The rule: every exported handler (GET, POST, PUT, PATCH, DELETE, HEAD,
// OPTIONS) in every route file under src/app/api must call one of the app's
// real checks, imported from the module that owns it. The call can be in the
// handler itself or in a function of the same file that the handler calls.
// A name in a comment or a string does not count, and neither does a local
// function that only shares a check's name.
//
// - Routes for signed-in people (staff and client-portal logins) need a
//   session check (SESSION_CHECKS).
// - Folders whose callers are not signed-in people each have their own
//   expected check (FOLDER_RULES). A route in one of them without that check
//   fails, so for example a new cron route must check CRON_SECRET.
// - The only routes allowed to have no check at all are in PUBLIC_ROUTES,
//   each with its reason. Adding one is a decision to make a route public.

type Check = {
  module: string;
  name: string;
  /** When set, the call's second argument must be exactly this: the env var the secret lives in. */
  secret?: string;
};

const PERMISSIONS = "@/lib/permissions";
const SECRET_COMPARE = "@/lib/secret-compare";

const SESSION_CHECKS: Check[] = [
  { module: "@/lib/auth", name: "auth" },
  { module: PERMISSIONS, name: "requireUser" },
  { module: PERMISSIONS, name: "requireAdmin" },
  { module: PERMISSIONS, name: "requireCapability" },
  { module: PERMISSIONS, name: "requireClientAccess" },
  { module: PERMISSIONS, name: "requireClientUserSession" },
  { module: PERMISSIONS, name: "resolveAssetActor" },
];

/** Keyed by the first folder under src/app/api. `who` says who calls these routes and how they prove it. */
const FOLDER_RULES: Record<string, { who: string; checks: Check[] }> = {
  cron: {
    who: "Vercel Cron, which sends Authorization: Bearer CRON_SECRET",
    checks: [{ module: SECRET_COMPARE, name: "checkBearer", secret: "process.env.CRON_SECRET" }],
  },
  agent: {
    who: "the outside agent API; callers send Authorization: Bearer AGENT_API_TOKEN",
    checks: [{ module: "@/lib/agent-auth", name: "requireAgentToken" }],
  },
  mcp: {
    who: "the Claude.ai connector; MCP_ACCESS_TOKEN is the [token] part of the address",
    checks: [{ module: SECRET_COMPARE, name: "safeEqualSecret", secret: "process.env.MCP_ACCESS_TOKEN" }],
  },
  review: {
    who: "guests reviewing one asset; the share-link token in the address is their only key",
    checks: [{ module: "@/lib/share-link", name: "resolveShareLinkAccess" }],
  },
  webhooks: {
    who: "outside services sending events (no routes yet); each must prove it is the sender with its shared secret, and any other proof (a signature check) is added here on purpose",
    checks: [
      { module: SECRET_COMPARE, name: "checkBearer" },
      { module: SECRET_COMPARE, name: "safeEqualSecret" },
    ],
  },
};

/** Paths relative to src/app/api. These routes deliberately answer anyone. */
const PUBLIC_ROUTES: Record<string, string> = {
  "auth/[...nextauth]/route.ts":
    "Auth.js itself: sign in, sign out, the CSRF token and your own session. It has to answer before anyone is signed in.",
  "health/route.ts": "the uptime check for the outside monitor. It answers only ok or not ok and the time, no data.",
};

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

type ParsedRoute = {
  imports: Map<string, { module: string; name: string }>;
  functions: Map<string, FunctionLike>;
  /** Exported method name to the function that runs it, or null when its code is not in this file. */
  handlers: Map<string, FunctionLike | null>;
};

function isFunctionLike(node: ts.Node | undefined): node is FunctionLike {
  return !!node && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node));
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isBindingElement(element) ? boundNames(element.name) : []));
}

function parseRoute(path: string, text: string): ParsedRoute {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports: ParsedRoute["imports"] = new Map();
  const functions: ParsedRoute["functions"] = new Map();
  const handlers: ParsedRoute["handlers"] = new Map();

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      if (clause && !clause.isTypeOnly && bindings && ts.isNamedImports(bindings)) {
        for (const spec of bindings.elements) {
          if (spec.isTypeOnly) continue;
          imports.set(spec.name.text, { module: statement.moduleSpecifier.text, name: (spec.propertyName ?? spec.name).text });
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isFunctionLike(decl.initializer)) functions.set(decl.name.text, decl.initializer);
      }
    }
  }

  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement) && METHODS.has(statement.name.text)) {
      handlers.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const decl of statement.declarationList.declarations) {
        for (const name of boundNames(decl.name).filter((n) => METHODS.has(n))) {
          // Only `export const GET = <function>` or `= <function of this file>` can be read.
          const init = ts.isIdentifier(decl.name) ? decl.initializer : undefined;
          const target = isFunctionLike(init) ? init : init && ts.isIdentifier(init) ? functions.get(init.text) : undefined;
          handlers.set(name, target ?? null);
        }
      }
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (!clause) {
        handlers.set("export *", null);
      } else if (ts.isNamedExports(clause)) {
        for (const spec of clause.elements.filter((s) => METHODS.has(s.name.text))) {
          const local = statement.moduleSpecifier ? undefined : functions.get((spec.propertyName ?? spec.name).text);
          handlers.set(spec.name.text, local ?? null);
        }
      }
    }
  }

  return { imports, functions, handlers };
}

function matches(call: ts.CallExpression, route: ParsedRoute, checks: Check[]): boolean {
  if (!ts.isIdentifier(call.expression)) return false;
  const imported = route.imports.get(call.expression.text);
  if (!imported) return false;
  const secretArg = call.arguments[1]?.getText().replace(/\s+/g, "");
  return checks.some(
    (check) =>
      check.module === imported.module && check.name === imported.name && (!check.secret || secretArg === check.secret)
  );
}

/** True when `fn`, or a function of the same file that it calls, calls one of `checks`. */
function callsCheck(fn: ts.Node, route: ParsedRoute, checks: Check[], seen = new Set<ts.Node>()): boolean {
  if (seen.has(fn)) return false;
  seen.add(fn);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      if (matches(node, route, checks)) {
        found = true;
        return;
      }
      const local = ts.isIdentifier(node.expression) ? route.functions.get(node.expression.text) : undefined;
      if (local && callsCheck(local, route, checks, seen)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

/** What is wrong with one route file, as readable lines. `routePath` is relative to src/app/api. */
function routeProblems(routePath: string, text: string): string[] {
  if (Object.hasOwn(PUBLIC_ROUTES, routePath)) return [];
  const folder = routePath.split("/")[0];
  const rule = Object.hasOwn(FOLDER_RULES, folder) ? FOLDER_RULES[folder] : null;
  const checks = rule ? rule.checks : SESSION_CHECKS;
  const wanted = `${rule ? `the ${folder} check` : "a session check"} (${checks.map((c) => `${c.name} from ${c.module}`).join(", ")})`;

  const route = parseRoute(routePath, text);
  if (route.handlers.size === 0) return [`${routePath}: no handler this guard can read`];
  const problems: string[] = [];
  for (const [method, fn] of route.handlers) {
    if (!fn) problems.push(`${routePath} ${method}: its code is not in this file, so its check cannot be seen`);
    else if (!callsCheck(fn, route, checks)) problems.push(`${routePath} ${method}: does not call ${wanted}`);
  }
  return problems;
}

const ROOT = process.cwd();
const API_DIR = join(ROOT, "src", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return /^route\.[cm]?[jt]sx?$/.test(entry.name) ? [relative(API_DIR, full).split(sep).join("/")] : [];
  });
}

const routes = routeFiles(API_DIR).map((path) => ({ path, text: readFileSync(join(API_DIR, path), "utf8") }));

describe("API route check scanner (self-check)", () => {
  const GATED = 'import { requireUser } from "@/lib/permissions";\n';

  it.each([
    ["a handler with no check", "tasks/route.ts", "export async function GET() { return Response.json([]); }"],
    [
      "a check named only in a comment",
      "tasks/route.ts",
      'import { auth } from "@/lib/auth";\n// await auth();\nexport async function GET() { return Response.json([]); }',
    ],
    ["a check named only in a string", "tasks/route.ts", 'export async function GET() { return Response.json("requireUser()"); }'],
    [
      "a local function that shares a check's name",
      "tasks/route.ts",
      "async function requireUser() {}\nexport async function GET() { await requireUser(); }",
    ],
    [
      "a check imported from the wrong module",
      "tasks/route.ts",
      'import { requireAdmin } from "@/lib/somewhere-else";\nexport async function GET() { await requireAdmin(); }',
    ],
    [
      "a check that is passed around but never called",
      "tasks/route.ts",
      'import { auth } from "@/lib/auth";\nexport async function GET() { return Response.json(String(auth)); }',
    ],
    ["handlers taken from another module", "tasks/route.ts", 'import { handlers } from "./x";\nexport const { GET, POST } = handlers;'],
    ["a handler re-exported from another file", "tasks/route.ts", 'export { GET } from "./other";'],
    ["everything re-exported from another file", "tasks/route.ts", 'export * from "./other";'],
    [
      "a cron route that only checks the session",
      "cron/new-job/route.ts",
      'import { auth } from "@/lib/auth";\nexport async function GET() { await auth(); }',
    ],
    [
      "a cron route that checks a different secret",
      "cron/new-job/route.ts",
      'import { checkBearer } from "@/lib/secret-compare";\nexport async function GET(request: Request) { if (!checkBearer(request, process.env.AGENT_API_TOKEN)) return; }',
    ],
    [
      "an agent route without the agent token",
      "agent/v1/new/route.ts",
      'import { auth } from "@/lib/auth";\nexport async function GET() { await auth(); }',
    ],
    ["a review route that skips the share-link lookup", "review/[token]/new/route.ts", "export async function POST() {}"],
    [
      "an MCP route that checks a different secret",
      "mcp/[token]/route.ts",
      'import { safeEqualSecret } from "@/lib/secret-compare";\nasync function handler(t: string) { safeEqualSecret(t, process.env.CRON_SECRET); }\nexport { handler as GET };',
    ],
    ["a new route in the health folder", "health/deep/route.ts", "export async function GET() {}"],
    ["a new route in the auth folder", "auth/extra/route.ts", "export async function POST() {}"],
    ["a file with no handler it can read", "tasks/route.ts", "export default async function handler() {}"],
  ])("flags %s", (_label, path, source) => {
    expect(routeProblems(path, source)).not.toEqual([]);
  });

  it("flags only the handler that skips the check", () => {
    const problems = routeProblems(
      "tasks/route.ts",
      `${GATED}export async function GET() { await requireUser(); }\nexport async function DELETE() {}`
    );
    expect(problems).toEqual([expect.stringContaining("tasks/route.ts DELETE")]);
  });

  it.each([
    ["a session check", "tasks/route.ts", 'import { auth } from "@/lib/auth";\nexport async function GET() { const s = await auth(); }'],
    [
      "a renamed import",
      "tasks/route.ts",
      'import { requireCapability as can } from "@/lib/permissions";\nexport async function POST() { await can("canEditTasks"); }',
    ],
    [
      "a check in a function of the same file",
      "tasks/route.ts",
      `${GATED}async function load() { await requireUser(); }\nexport async function GET() { await load(); }`,
    ],
    [
      "a check in an arrow function of the same file",
      "tasks/route.ts",
      `${GATED}const gate = async () => { await requireUser(); };\nexport async function GET() { await gate(); }`,
    ],
    [
      "a check inside a callback",
      "assets/upload-token/route.ts",
      'import { requireCapability } from "@/lib/permissions";\nexport async function POST() { await handleUpload({ onBeforeGenerateToken: async () => { await requireCapability("canUploadAssets"); } }); }',
    ],
    ["a handler written as a const arrow", "tasks/route.ts", `${GATED}export const GET = async () => { await requireUser(); };`],
    [
      "one function exported under method names",
      "tasks/route.ts",
      `${GATED}async function handler() { await requireUser(); }\nexport { handler as GET, handler as POST };`,
    ],
    [
      "exports that are not handlers",
      "tasks/route.ts",
      `${GATED}export const runtime = "nodejs";\nexport const TASK_INCLUDE = {};\nexport async function GET() { await requireUser(); }`,
    ],
    [
      "a cron route that checks CRON_SECRET",
      "cron/new-job/route.ts",
      'import { checkBearer } from "@/lib/secret-compare";\nexport async function GET(request: Request) { if (!checkBearer(request, process.env.CRON_SECRET)) return; }',
    ],
    [
      "an agent route with the agent token",
      "agent/v1/new/route.ts",
      'import { requireAgentToken } from "@/lib/agent-auth";\nexport async function GET(request: Request) { const no = requireAgentToken(request); }',
    ],
    [
      "an MCP route that checks MCP_ACCESS_TOKEN through a helper",
      "mcp/[token]/route.ts",
      'import { safeEqualSecret } from "@/lib/secret-compare";\nfunction ok(t: string) { return safeEqualSecret(t, process.env.MCP_ACCESS_TOKEN); }\nasync function handler() { ok("x"); }\nexport { handler as GET, handler as POST };',
    ],
    [
      "a review route that resolves the share link",
      "review/[token]/new/route.ts",
      'import { resolveShareLinkAccess } from "@/lib/share-link";\nexport async function POST() { await resolveShareLinkAccess("t"); }',
    ],
    ["a listed public route", "health/route.ts", "export async function GET() {}"],
  ])("accepts %s", (_label, path, source) => {
    expect(routeProblems(path, source)).toEqual([]);
  });
});

describe("every API route checks who is calling (audit M1)", () => {
  it("finds the API route files (so the scan is not empty)", () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.map((r) => r.path)).toEqual(
      expect.arrayContaining([
        "tasks/route.ts",
        "cron/backup/route.ts",
        "review/[token]/unlock/route.ts",
        "agent/v1/openapi.json/route.ts",
        "mcp/[token]/route.ts",
        ...Object.keys(PUBLIC_ROUTES),
      ])
    );
  });

  it("every handler calls the check its folder expects, or is a listed public route", () => {
    expect(routes.flatMap((route) => routeProblems(route.path, route.text))).toEqual([]);
  });

  it.each(Object.keys(PUBLIC_ROUTES))("listed public route %s still exists", (path) => {
    expect(existsSync(join(API_DIR, path))).toBe(true);
  });

  it("the Auth.js route only hands out Auth.js's own handlers", () => {
    const route = parseRoute("auth/[...nextauth]/route.ts", readFileSync(join(API_DIR, "auth/[...nextauth]/route.ts"), "utf8"));
    expect(route.imports.get("handlers")).toEqual({ module: "@/lib/auth", name: "handlers" });
    expect([...route.handlers.keys()].sort()).toEqual(["GET", "POST"]);
    expect(readFileSync(join(API_DIR, "auth/[...nextauth]/route.ts"), "utf8")).toMatch(
      /export\s+const\s*\{\s*GET\s*,\s*POST\s*\}\s*=\s*handlers\s*;/
    );
  });

  it("every check named here is a real export of its module", () => {
    const all = [...SESSION_CHECKS, ...Object.values(FOLDER_RULES).flatMap((rule) => rule.checks)];
    for (const check of all) {
      const path = join(ROOT, "src", `${check.module.replace(/^@\//, "")}.ts`);
      const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      const exported = file.statements.flatMap((statement) => {
        if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement)) return [statement.name.text];
        if (ts.isVariableStatement(statement) && isExported(statement)) {
          return statement.declarationList.declarations.flatMap((decl) => boundNames(decl.name));
        }
        return [];
      });
      expect(exported, `${check.name} from ${check.module}`).toContain(check.name);
    }
  });
});
