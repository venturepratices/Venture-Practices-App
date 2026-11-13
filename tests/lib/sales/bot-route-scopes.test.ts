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

/** "METHOD folder" to the scope each handler passes to requireSalesActor ("null" for never). */
function handlerScopes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of routeFiles(ROOT)) {
    const folder = relative(ROOT, file).split(sep).slice(0, -1).join("/");
    const src = readFileSync(file, "utf8");
    const parts = src.split(/export async function (GET|POST|PUT|PATCH|DELETE)\(/).slice(1);
    for (let i = 0; i < parts.length; i += 2) {
      const scope = /requireSalesActor\(request, (null|"[a-z]+")\)/.exec(parts[i + 1]);
      const admin = /requireAdmin\(\)/.test(parts[i + 1]);
      found.set(`${parts[i]} ${folder}`, scope ? scope[1].replaceAll('"', "") : admin ? "admin" : "MISSING");
    }
  }
  return found;
}

describe("Sales routes and bot permissions", () => {
  const scopes = handlerScopes();

  it("every handler goes through requireSalesActor or requireAdmin", () => {
    expect([...scopes].filter(([, scope]) => scope === "MISSING")).toEqual([]);
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
