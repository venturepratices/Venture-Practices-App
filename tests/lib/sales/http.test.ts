import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The shared Sales route helpers, the Origin check (spec 18.3: SameSite cookies
// plus an Origin check on mutating requests), and a guard that every mutating
// Sales route runs it. Nothing here reaches a real database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const memberUpdate = vi.fn(async () => ({ id: "r" }));
vi.mock("@/lib/prisma", () => ({ prisma: { teamMember: { update: (...args: unknown[]) => memberUpdate(...(args as [])) } } }));

const { assertSameOrigin, fail, failResponse, readJson, searchParamsRecord } = await import("@/lib/sales/http");
const viewRoute = await import("@/app/api/sales/view/route");

const URL_VIEW = "https://app.example.com/api/sales/view";
const request = (headers: Record<string, string>, init: RequestInit = {}) =>
  new Request(URL_VIEW, { method: "PUT", ...init, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  memberUpdate.mockClear();
  requireSalesUserMock.mockReset().mockResolvedValue({ userId: "r", isAdmin: false, seesAllDeals: false, via: "user" });
});

describe("assertSameOrigin", () => {
  it("lets a request with no Origin through (non-browser clients)", () => {
    expect(assertSameOrigin(request({ host: "app.example.com" }))).toBeNull();
  });

  it("lets a same-origin request through", () => {
    expect(assertSameOrigin(request({ host: "app.example.com", origin: "https://app.example.com" }))).toBeNull();
  });

  it("blocks a request from another site", () => {
    expect(assertSameOrigin(request({ host: "app.example.com", origin: "https://evil.example" }))).toEqual({
      ok: false,
      status: 403,
      error: "Request blocked.",
    });
  });

  it("blocks an Origin of null (sandboxed frames, file pages)", () => {
    expect(assertSameOrigin(request({ host: "app.example.com", origin: "null" }))?.status).toBe(403);
  });

  it("blocks an Origin that is not a URL", () => {
    expect(assertSameOrigin(request({ host: "app.example.com", origin: "app.example.com" }))?.status).toBe(403);
  });

  it("compares against the forwarded host behind a proxy", () => {
    expect(
      assertSameOrigin(
        request({ "x-forwarded-host": "app.example.com", host: "internal:3000", origin: "https://app.example.com" }),
      ),
    ).toBeNull();
    expect(
      assertSameOrigin(request({ "x-forwarded-host": "app.example.com", host: "internal:3000", origin: "http://internal:3000" }))
        ?.status,
    ).toBe(403);
  });

  it("blocks a same-name host on another port", () => {
    expect(assertSameOrigin(request({ host: "app.example.com", origin: "https://app.example.com:8443" }))?.status).toBe(403);
  });
});

describe("fail and failResponse", () => {
  it("sends the error, and the code only when there is one", async () => {
    const plain = failResponse(fail(404, "Deal not found."));
    expect(plain.status).toBe(404);
    expect(await plain.json()).toEqual({ error: "Deal not found." });

    const coded = failResponse(fail(422, "Add the value first.", "PROPOSAL_NEEDS_VALUE"));
    expect(coded.status).toBe(422);
    expect(await coded.json()).toEqual({ error: "Add the value first.", code: "PROPOSAL_NEEDS_VALUE" });
  });
});

describe("searchParamsRecord", () => {
  it("keeps every value of a repeated param, in order", () => {
    const req = new Request("https://app.example.com/api/sales/deals?view=list&q=oak&view=board");
    expect(searchParamsRecord(req)).toEqual({ view: ["list", "board"], q: ["oak"] });
  });

  it("is empty without a query string", () => {
    expect(searchParamsRecord(new Request("https://app.example.com/api/sales/deals"))).toEqual({});
  });
});

describe("readJson", () => {
  const schema = z.strictObject({ name: z.string().min(1, "Give it a name.") });

  it("returns the parsed body", async () => {
    const body = JSON.stringify({ name: "Oak" });
    expect(await readJson(request({ host: "app.example.com" }, { body }), schema)).toEqual({ ok: true, data: { name: "Oak" } });
  });

  it("refuses a body that is not JSON", async () => {
    expect(await readJson(request({ host: "app.example.com" }, { body: "{not json" }), schema)).toEqual({
      ok: false,
      status: 400,
      error: "Invalid input.",
    });
  });

  it("answers with the first problem's message", async () => {
    const result = await readJson(request({ host: "app.example.com" }, { body: JSON.stringify({ name: "" }) }), schema);
    expect(result).toEqual({ ok: false, status: 400, error: "Give it a name." });
  });

  it("refuses unknown keys", async () => {
    const result = await readJson(
      request({ host: "app.example.com" }, { body: JSON.stringify({ name: "Oak", extra: 1 }) }),
      schema,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("checks the Origin before it reads anything", async () => {
    const result = await readJson(
      request({ host: "app.example.com", origin: "https://evil.example" }, { body: JSON.stringify({ name: "Oak" }) }),
      schema,
    );
    expect(result).toEqual({ ok: false, status: 403, error: "Request blocked." });
  });
});

describe("PUT /api/sales/view from another site", () => {
  const body = JSON.stringify({ pipeline: "direct-mail", view: "list", scope: "mine" });

  it("is blocked and saves nothing", async () => {
    const res = await viewRoute.PUT(request({ host: "app.example.com", origin: "https://evil.example" }, { body }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(memberUpdate).not.toHaveBeenCalled();
  });

  it("saves when the Origin is this site", async () => {
    const res = await viewRoute.PUT(request({ host: "app.example.com", origin: "https://app.example.com" }, { body }));

    expect(res.status).toBe(200);
    expect(memberUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("guard: every mutating Sales route checks the Origin", () => {
  const root = path.join(process.cwd(), "src", "app", "api", "sales");
  const routeFiles = (fs.readdirSync(root, { recursive: true }) as string[])
    .filter((file) => path.basename(file) === "route.ts")
    .map((file) => ({ file, source: fs.readFileSync(path.join(root, file), "utf8") }));

  const exportsMethod = (source: string, method: string) =>
    new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${method}\\b`).test(source);

  it("finds the Sales route files", () => {
    expect(routeFiles.map((route) => route.file.replace(/\\/g, "/"))).toEqual(
      expect.arrayContaining(["settings/route.ts", "bots/route.ts", "bots/[botId]/route.ts", "view/route.ts"]),
    );
  });

  it("DELETE handlers call assertSameOrigin", () => {
    for (const { file, source } of routeFiles) {
      if (exportsMethod(source, "DELETE")) expect(source, file).toContain("assertSameOrigin(");
    }
  });

  it("POST, PATCH and PUT handlers call readJson or assertSameOrigin", () => {
    for (const { file, source } of routeFiles) {
      if (["POST", "PATCH", "PUT"].some((method) => exportsMethod(source, method))) {
        expect(source.includes("readJson(") || source.includes("assertSameOrigin("), file).toBe(true);
      }
    }
  });
});
