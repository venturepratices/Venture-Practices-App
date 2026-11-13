import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { BOT_SCOPE_ENDPOINTS } from "@/lib/sales/bot-endpoints";

// Deny by default, checked on the source: every Sales route handler names the
// permission a bot needs (or null: bots never), and the list below is the only
// place a route is opened to bots. Opening another route means changing this
// test on purpose. Deleting, files, settings, merging and bulk work stay null.

const ROOT = join(process.cwd(), "src/app/api/sales");

const OPEN_TO_BOTS: Record<string, string> = {
  "GET deals": "read",
  "POST deals": "create",
  "GET deals/[dealId]": "read",
  "GET deals/[dealId]/timeline": "read",
  "POST deals/[dealId]/notes": "notes",
  "POST deals/[dealId]/activities": "activities",
  "POST deals/[dealId]/move": "move",
  "GET leads": "read",
  "POST leads": "create",
  "GET leads/[leadId]": "read",
  "GET leads/[leadId]/timeline": "read",
  "POST leads/[leadId]/notes": "notes",
  "POST leads/[leadId]/activities": "activities",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

const METHOD = "(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)";
/** Any other way a file could export a handler; the scanner refuses these rather than skip them. */
const OTHER_EXPORTS = [
  new RegExp(`export\\s+(const|let|var)\\s+${METHOD}\\b`),
  new RegExp(`export\\s+function\\s+${METHOD}\\b`),
  new RegExp(`export\\s*\\{[^}]*\\b(as\\s+)?${METHOD}\\b[^}]*\\}`),
];

/**
 * Each handler in one route file: the permission it passes to requireSalesActor
 * ("null" for never), "admin" for requireAdmin, "MISSING" with no gate,
 * "NOT_FIRST" when anything is awaited before the gate, "UNSUPPORTED" when a
 * handler is exported in a shape this scanner cannot read.
 */
function scanHandlers(src: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const pattern of OTHER_EXPORTS) {
    const hit = pattern.exec(src);
    if (hit) found.set(hit[hit.length - 1], "UNSUPPORTED");
  }
  const parts = src.split(new RegExp(`export async function ${METHOD}\\(`)).slice(1);
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i + 1].split(/\nexport /)[0];
    const firstAwait = /await\s+([A-Za-z_.]+)\(/.exec(body);
    const scope = /requireSalesActor\(request, (null|"[a-z]+")\)/.exec(body);
    const gate = firstAwait?.[1];
    let result = "MISSING";
    if (gate === "requireSalesActor" && scope) result = scope[1].replaceAll('"', "");
    else if (gate === "requireAdmin") result = "admin";
    else if (scope || /requireAdmin\(\)/.test(body)) result = "NOT_FIRST";
    found.set(parts[i], result);
  }
  return found;
}

/** "METHOD folder" to the scope each handler passes to requireSalesActor ("null" for never). */
function handlerScopes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of routeFiles(ROOT)) {
    const folder = relative(ROOT, file).split(sep).slice(0, -1).join("/");
    for (const [method, scope] of scanHandlers(readFileSync(file, "utf8"))) found.set(`${method} ${folder}`, scope);
  }
  return found;
}

describe("the scanner itself", () => {
  it("reads a gate that comes first", () => {
    const src = 'export async function GET(request: Request) {\n  try {\n    const actor = await requireSalesActor(request, "read");\n    await load();\n  } catch {}\n}\n';
    expect(scanHandlers(src)).toEqual(new Map([["GET", "read"]]));
  });

  it("flags a gate that comes after another await", () => {
    const src = 'export async function POST(request: Request) {\n  const body = await request.json();\n  const actor = await requireSalesActor(request, "notes");\n}\n';
    expect(scanHandlers(src).get("POST")).toBe("NOT_FIRST");
  });

  it("flags handlers exported in other shapes instead of skipping them", () => {
    expect(scanHandlers("export const GET = async () => {};").get("GET")).toBe("UNSUPPORTED");
    expect(scanHandlers("async function handler() {}\nexport { handler as POST };").get("POST")).toBe("UNSUPPORTED");
    expect(scanHandlers("export function DELETE() {}").get("DELETE")).toBe("UNSUPPORTED");
  });

  it("flags a handler with no gate", () => {
    expect(scanHandlers("export async function GET() {\n  return load();\n}\n").get("GET")).toBe("MISSING");
  });
});

describe("Sales routes and bot permissions", () => {
  const scopes = handlerScopes();

  it("every handler goes through requireSalesActor or requireAdmin first, in a shape the scanner reads", () => {
    expect([...scopes].filter(([, scope]) => ["MISSING", "NOT_FIRST", "UNSUPPORTED"].includes(scope))).toEqual([]);
  });

  it("only the listed routes are open to bots, each with its permission", () => {
    const open = Object.fromEntries([...scopes].filter(([, s]) => s !== "null" && s !== "admin"));
    expect(open).toEqual(OPEN_TO_BOTS);
  });

  it("no delete, file, settings, merge, bulk or export route is open to bots", () => {
    for (const [handler, scope] of scopes) {
      if (/^DELETE|files|settings|merge|bulk|export|stages|bots|views?$|archive|convert|fields/.test(handler)) {
        expect([handler, scope]).toEqual([handler, expect.stringMatching(/^(null|admin)$/)]);
      }
    }
  });

  it("the How to connect panel lists exactly the routes open to bots", () => {
    const listed = BOT_SCOPE_ENDPOINTS.flatMap((group) =>
      group.endpoints.map((e) => [`${e.method} ${e.path.replace("/api/sales/", "").replace("{dealId}", "[dealId]").replace("{leadId}", "[leadId]")}`, group.scope]),
    );
    expect(Object.fromEntries(listed)).toEqual(OPEN_TO_BOTS);
  });
});
