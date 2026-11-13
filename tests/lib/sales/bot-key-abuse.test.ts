import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FakeToken } from "./bot-fake-db";

// Abuse signals: bad keys from one address are slowed down without touching the
// database, a bot that keeps hitting its limits or asking for what it may not
// do is turned off by itself, and admins (only admins) are told in the app.

vi.mock("@/lib/prisma", async () => (await import("./bot-fake-db")).prismaModule);

const { fake, prismaFake } = await import("./bot-fake-db");
const { authenticateBot, generateBotSecret } = await import("@/lib/sales/bot-tokens");
const { resetBadKeyThrottle, BAD_KEY_LIMIT } = await import("@/lib/sales/bot-guard");
const { BOT_ABUSE_LIMITS } = await import("@/lib/sales/bot-alerts");

const T0 = new Date("2026-11-13T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const CALL = { method: "GET", path: "/api/sales/deals", ip: "203.0.113.7", userAgent: "Muse/1.0", scope: "read" as const };

function addToken(overrides: Partial<FakeToken> = {}) {
  const { secret, hash } = generateBotSecret();
  fake.tokens.push({
    id: "bot1",
    name: "Muse",
    tokenHash: hash,
    enabled: true,
    scopes: ["read"],
    pipelineKeys: [],
    allPipelines: true,
    ownDealsOnly: true,
    mustRotate: false,
    expiresAt: at(30 * 86_400_000),
    lastUsedAt: null,
    lastUsedIp: null,
    knownIps: ["203.0.113.7"],
    offReason: null,
    offAt: null,
    actingForId: "p1",
    actingFor: { id: "p1", isAdmin: false, canUseSales: true, salesSeesAllDeals: true },
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

describe("bad keys from one address", () => {
  it(`slows an address down after ${BAD_KEY_LIMIT} bad keys, before any database read`, async () => {
    const header = addToken();
    for (let i = 0; i < BAD_KEY_LIMIT; i += 1) await authenticateBot("Bearer vpb_nope", T0, CALL);
    const findUnique = vi.spyOn(prismaFake.botToken, "findUnique");
    // Even a good key from that address waits now.
    await expect(authenticateBot(header, T0, CALL)).resolves.toMatchObject({ ok: false, status: 429 });
    expect(findUnique).not.toHaveBeenCalled();
    // Another address is not affected.
    await expect(authenticateBot(header, T0, { ...CALL, ip: "198.51.100.1" })).resolves.toMatchObject({ ok: true });
    findUnique.mockRestore();
  });

  it("lets the address try again after the wait", async () => {
    const header = addToken();
    for (let i = 0; i < BAD_KEY_LIMIT; i += 1) await authenticateBot("Bearer vpb_nope", T0, CALL);
    await expect(authenticateBot(header, at(11 * 60_000), CALL)).resolves.toMatchObject({ ok: true });
  });
});

describe("turning a bot off by itself", () => {
  it(`turns off after hitting the minute limit in ${BOT_ABUSE_LIMITS.limitMinutes} different minutes of one day`, async () => {
    const header = addToken();
    for (let minute = 0; minute < BOT_ABUSE_LIMITS.limitMinutes; minute += 1) {
      for (let i = 0; i < 61; i += 1) await authenticateBot(header, at(minute * 60_000 + i), CALL);
    }
    expect(fake.tokens[0]).toMatchObject({ enabled: false, offReason: expect.stringContaining("call limit") });
    expect(fake.tokens[0].offAt).toBeInstanceOf(Date);
    expect(fake.audits).toEqual([
      expect.objectContaining({ entityType: "BotToken", entityId: "bot1", action: "auto_turned_off", botTokenId: "bot1" }),
    ]);
    expect(fake.notifications.map((n) => n.recipientId)).toEqual(["admin1", "admin2"]);
    expect(fake.notifications[0]).toMatchObject({ type: "BOT_ALERT", linkPath: "/sales/settings/bots" });
  });

  it("does not turn off for one busy minute", async () => {
    const header = addToken();
    for (let i = 0; i < 70; i += 1) await authenticateBot(header, at(i), CALL);
    expect(fake.tokens[0].enabled).toBe(true);
  });

  it(`turns off after ${BOT_ABUSE_LIMITS.refusedPerDay} refused permission checks in one day`, async () => {
    const header = addToken({ scopes: ["read"] });
    for (let i = 0; i < BOT_ABUSE_LIMITS.refusedPerDay; i += 1) {
      await authenticateBot(header, at(i * 2000), { ...CALL, method: "POST", scope: "move" });
    }
    expect(fake.tokens[0]).toMatchObject({ enabled: false, offReason: expect.stringContaining("not allowed") });
  });
});

describe("alerts to admins, in the app only", () => {
  it("tells admins once a day when a turned-off key is still being used", async () => {
    const header = addToken({ enabled: false });
    await authenticateBot(header, T0, CALL);
    await authenticateBot(header, at(5000), CALL);
    expect(fake.notifications).toHaveLength(2);
    expect(fake.notifications[0].message).toContain("turned off");
  });

  it("tells admins when a key is used from a new address, and remembers it", async () => {
    const header = addToken();
    await authenticateBot(header, T0, { ...CALL, ip: "198.51.100.9" });
    await authenticateBot(header, at(120_000), { ...CALL, ip: "198.51.100.9" });
    expect(fake.notifications).toHaveLength(2);
    expect(fake.notifications[0].message).toContain("new address");
    expect(fake.tokens[0].knownIps).toContain("198.51.100.9");
    expect(fake.tokens[0].lastUsedIp).toBe("198.51.100.9");
  });

  it("only ever writes in-app rows to admins", async () => {
    const header = addToken({ enabled: false });
    await authenticateBot(header, T0, CALL);
    for (const row of fake.notifications) expect(["admin1", "admin2"]).toContain(row.recipientId);
  });
});
