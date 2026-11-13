import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FakeToken } from "./bot-fake-db";

// The key check's refusals: every bad key gets one message, a paused system
// refuses everything, and a known key's every call lands in the call log.

vi.mock("@/lib/prisma", async () => (await import("./bot-fake-db")).prismaModule);

const { fake, prismaFake } = await import("./bot-fake-db");
const { authenticateBot, generateBotSecret } = await import("@/lib/sales/bot-tokens");
const { resetBadKeyThrottle } = await import("@/lib/sales/bot-guard");

const T0 = new Date("2026-11-13T10:00:00.000Z");
const DAY = 86_400_000;
const INVALID = { ok: false, status: 401, error: "Invalid bot key." };
const CALL = { method: "GET", path: "/api/sales/deals", ip: "203.0.113.7", userAgent: "Muse/1.0", scope: "read" as const };

function addToken(overrides: Partial<FakeToken> = {}, person: Partial<FakeToken["actingFor"]> = {}) {
  const { secret, hash } = generateBotSecret();
  fake.tokens.push({
    id: `bot${fake.tokens.length + 1}`,
    name: "Muse",
    tokenHash: hash,
    enabled: true,
    scopes: ["read", "notes"],
    pipelineKeys: [],
    allPipelines: true,
    ownDealsOnly: true,
    mustRotate: false,
    expiresAt: new Date(T0.getTime() + 30 * DAY),
    lastUsedAt: null,
    lastUsedIp: null,
    knownIps: ["203.0.113.7"],
    offReason: null,
    offAt: null,
    actingForId: "p1",
    actingFor: { id: "p1", isAdmin: false, canUseSales: true, salesSeesAllDeals: true, ...person },
    ...overrides,
  });
  return `Bearer ${secret}`;
}

beforeEach(() => {
  fake.reset();
  resetBadKeyThrottle();
  vi.stubEnv("SALES_BOTS_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("one message for every bad key", () => {
  it.each([
    ["turned off", { enabled: false }],
    ["expired", { expiresAt: new Date(T0.getTime() - 1) }],
    ["with no expiry date", { expiresAt: null }],
    ["waiting to be rotated after a restore", { mustRotate: true }],
  ])("refuses a key that is %s with the invalid-key 401", async (_label, overrides) => {
    const header = addToken(overrides as Partial<FakeToken>);
    await expect(authenticateBot(header, T0, CALL)).resolves.toEqual(INVALID);
  });

  it("refuses a key whose person lost Sales access with the same 401", async () => {
    const header = addToken({}, { canUseSales: false, isAdmin: false });
    await expect(authenticateBot(header, T0, CALL)).resolves.toEqual(INVALID);
  });
});

describe("the pause switch", () => {
  it("refuses every key while SALES_BOTS_ENABLED is not true, and writes nothing", async () => {
    vi.stubEnv("SALES_BOTS_ENABLED", "");
    const header = addToken();
    await expect(authenticateBot(header, T0, CALL)).resolves.toEqual({ ok: false, status: 403, error: "Bot keys are paused." });
    expect(fake.calls).toHaveLength(0);
    expect(prismaFake.botTokenUsage.upsert).not.toHaveBeenCalled();
  });
});

describe("the call log", () => {
  it("records an allowed call: which key, what, from where and the result, never the key", async () => {
    const header = addToken();
    await authenticateBot(header, T0, CALL);
    expect(fake.calls).toEqual([
      expect.objectContaining({ tokenId: "bot1", method: "GET", path: "/api/sales/deals", scope: "read", status: 200, ipAddress: "203.0.113.7", userAgent: "Muse/1.0", at: T0 }),
    ]);
    expect(JSON.stringify(fake.calls)).not.toContain(header.slice(7));
  });

  it("records a refused call by a known key with its status", async () => {
    const header = addToken({ enabled: false });
    await authenticateBot(header, T0, CALL);
    expect(fake.calls).toEqual([expect.objectContaining({ tokenId: "bot1", status: 401 })]);
  });

  it("writes nothing at all for an unknown key", async () => {
    addToken();
    await authenticateBot(`Bearer ${generateBotSecret().secret}`, T0, CALL);
    expect(fake.calls).toHaveLength(0);
    expect(fake.notifications).toHaveLength(0);
  });

  it("caps the path and user agent it stores", async () => {
    const header = addToken();
    await authenticateBot(header, T0, { ...CALL, path: `/api/sales/${"x".repeat(600)}`, userAgent: "y".repeat(600) });
    expect((fake.calls[0].path as string).length).toBeLessThanOrEqual(255);
    expect((fake.calls[0].userAgent as string).length).toBeLessThanOrEqual(255);
  });
});

describe("permissions", () => {
  it("refuses a call its permissions do not cover (403) and logs it", async () => {
    const header = addToken({ scopes: ["read"] });
    await expect(authenticateBot(header, T0, { ...CALL, method: "POST", scope: "move" })).resolves.toEqual({
      ok: false,
      status: 403,
      error: "This bot is not allowed to do that.",
    });
    expect(fake.calls[0]).toMatchObject({ status: 403, scope: "move" });
  });

  it("refuses a route bots may never use (scope null)", async () => {
    const header = addToken({ scopes: ["read", "notes", "activities", "move", "create"] });
    await expect(authenticateBot(header, T0, { ...CALL, method: "DELETE", scope: null })).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("hands the route the pipelines and the own-deals rule", async () => {
    const header = addToken({ allPipelines: false, pipelineKeys: ["direct-mail"], ownDealsOnly: true });
    const result = await authenticateBot(header, T0, CALL);
    expect(result).toMatchObject({ ok: true, actor: { seesAllDeals: false, allPipelines: false, pipelineKeys: ["direct-mail"] } });
  });

  it("lets a bot see everyone's deals only when allowed and the person may too", async () => {
    const header = addToken({ ownDealsOnly: false });
    expect(await authenticateBot(header, T0, CALL)).toMatchObject({ ok: true, actor: { seesAllDeals: true } });
  });
});
