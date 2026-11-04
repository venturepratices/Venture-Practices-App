import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// A small in-memory stand-in for the two bot tables, so the quota and
// lastUsedAt rules run for real without touching a database.
type FakeToken = {
  id: string;
  tokenHash: string;
  enabled: boolean;
  scopes: string[];
  pipelineKeys: string[];
  lastUsedAt: Date | null;
  actingFor: { id: string; isAdmin: boolean; canUseSales: boolean; salesSeesAllDeals: boolean };
};
type UsageKey = { tokenId: string; kind: string; windowStart: Date };

const db = { tokens: [] as FakeToken[], usage: new Map<string, number>() };
const usageKey = (k: UsageKey) => `${k.tokenId}|${k.kind}|${k.windowStart.toISOString()}`;

const tokenUpdate = vi.fn(async (args: { where: { id: string }; data: Partial<FakeToken> }) => {
  const token = db.tokens.find((t) => t.id === args.where.id);
  if (!token) throw new Error("not found");
  Object.assign(token, args.data);
  return token;
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    botToken: {
      findUnique: async (args: { where: { tokenHash: string } }) =>
        db.tokens.find((t) => t.tokenHash === args.where.tokenHash) ?? null,
      update: (args: { where: { id: string }; data: Partial<FakeToken> }) => tokenUpdate(args),
    },
    botTokenUsage: {
      upsert: async (args: { where: { tokenId_kind_windowStart: UsageKey }; create: UsageKey }) => {
        const key = usageKey(args.where.tokenId_kind_windowStart);
        const count = (db.usage.get(key) ?? 0) + 1;
        db.usage.set(key, count);
        return { ...args.create, count };
      },
      deleteMany: async () => ({ count: 0 }),
    },
  },
}));

const { BOT_LIMITS, BOT_ROLE_PRESETS, BOT_SCOPES, authenticateBot, botCan, generateBotSecret } = await import(
  "@/lib/sales/bot-tokens"
);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function addToken(overrides: Partial<FakeToken> = {}, person: Partial<FakeToken["actingFor"]> = {}) {
  const { secret, hash } = generateBotSecret();
  db.tokens.push({
    id: `bot${db.tokens.length + 1}`,
    tokenHash: hash,
    enabled: true,
    scopes: [...BOT_ROLE_PRESETS.helper],
    pipelineKeys: [],
    lastUsedAt: null,
    actingFor: { id: "p1", isAdmin: false, canUseSales: true, salesSeesAllDeals: false, ...person },
    ...overrides,
  });
  return `Bearer ${secret}`;
}

const T0 = new Date("2026-11-05T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(() => {
  db.tokens = [];
  db.usage.clear();
  tokenUpdate.mockClear();
});

describe("generateBotSecret", () => {
  it("makes a 47-character vpb_ secret stored only as its SHA-256 hash", () => {
    const { secret, hash, last4 } = generateBotSecret();
    expect(secret).toMatch(/^vpb_[A-Za-z0-9_-]{43}$/);
    expect(secret).toHaveLength(47);
    expect(hash).toBe(sha256(secret));
    expect(hash).not.toBe(secret);
    expect(last4).toBe(secret.slice(-4));
  });

  it("never repeats a secret", () => {
    expect(generateBotSecret().secret).not.toBe(generateBotSecret().secret);
  });
});

describe("bot roles", () => {
  it("has no scope for delete, export or settings", () => {
    expect(BOT_SCOPES).toEqual(["read", "notes", "activities", "move", "create"]);
    expect(BOT_ROLE_PRESETS).toEqual({
      read: ["read"],
      helper: ["read", "notes", "activities"],
      rep: ["read", "notes", "activities", "move", "create"],
    });
  });

  it("botCan follows the token's scopes", () => {
    const helper = { userId: "p1", isAdmin: false, seesAllDeals: true, via: "bot" as const, scopes: BOT_ROLE_PRESETS.helper };
    expect(botCan(helper, "move")).toBe(false);
    expect(botCan(helper, "notes")).toBe(true);
    expect(botCan({ ...helper, scopes: undefined }, "read")).toBe(false);
  });

  it("botCan does not limit a signed-in person, who is limited by capabilities instead", () => {
    expect(botCan({ userId: "u1", isAdmin: false, seesAllDeals: true, via: "user" }, "move")).toBe(true);
  });
});

describe("authenticateBot", () => {
  it("rejects a missing header (401)", async () => {
    await expect(authenticateBot(null, T0)).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a header that is not a vpb_ bearer key (401)", async () => {
    await expect(authenticateBot("Basic abc", T0)).resolves.toMatchObject({ ok: false, status: 401 });
    await expect(authenticateBot("Bearer sk_abc", T0)).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it("rejects an unknown key (401) with the same message as a missing one", async () => {
    const missing = await authenticateBot(null, T0);
    const unknown = await authenticateBot(`Bearer ${generateBotSecret().secret}`, T0);
    expect(unknown).toMatchObject({ ok: false, status: 401 });
    expect(!unknown.ok && unknown.error).toBe(!missing.ok && missing.error);
  });

  it("rejects a turned-off key (401)", async () => {
    const header = addToken({ enabled: false });
    await expect(authenticateBot(header, T0)).resolves.toEqual({
      ok: false,
      status: 401,
      error: "This bot is turned off.",
    });
  });

  it("stops at once when the person it works for loses Sales access (403)", async () => {
    const header = addToken({}, { canUseSales: false, isAdmin: false });
    await expect(authenticateBot(header, T0)).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("works for an admin even with the Sales switch off", async () => {
    const header = addToken({}, { canUseSales: false, isAdmin: true });
    await expect(authenticateBot(header, T0)).resolves.toMatchObject({ ok: true });
  });

  it("returns the person it works for, as a bot, with the token's scopes", async () => {
    const header = addToken({ scopes: ["read"], pipelineKeys: ["direct-mail"] });
    const result = await authenticateBot(header, T0);
    expect(result).toEqual({
      ok: true,
      actor: {
        userId: "p1",
        isAdmin: false,
        seesAllDeals: false,
        via: "bot",
        botTokenId: "bot1",
        scopes: ["read"],
        pipelineKeys: ["direct-mail"],
      },
    });
  });

  it(`allows ${BOT_LIMITS.perMinute} calls a minute and refuses the next one (429)`, async () => {
    expect(BOT_LIMITS).toEqual({ perMinute: 60, perDay: 2000 });
    const header = addToken();
    for (let i = 0; i < 60; i += 1) {
      expect((await authenticateBot(header, at(i * 500))).ok).toBe(true);
    }
    await expect(authenticateBot(header, at(59_000))).resolves.toMatchObject({ ok: false, status: 429 });
    // A new minute starts a new count.
    await expect(authenticateBot(header, at(60_000))).resolves.toMatchObject({ ok: true });
  });

  it(`allows ${BOT_LIMITS.perDay} calls a UTC day and refuses the next one (429)`, async () => {
    const header = addToken();
    // Two seconds apart keeps every minute well under its own limit.
    for (let i = 0; i < 2000; i += 1) {
      expect((await authenticateBot(header, at(i * 2000))).ok).toBe(true);
    }
    await expect(authenticateBot(header, at(2000 * 2000))).resolves.toMatchObject({ ok: false, status: 429 });
    // The next UTC day starts a new count.
    await expect(authenticateBot(header, new Date("2026-11-06T00:00:05.000Z"))).resolves.toMatchObject({ ok: true });
  });

  it("writes lastUsedAt at most once a minute", async () => {
    const header = addToken();
    await authenticateBot(header, T0);
    await authenticateBot(header, at(30_000));
    await authenticateBot(header, at(59_999));
    expect(tokenUpdate).toHaveBeenCalledTimes(1);
    expect(db.tokens[0].lastUsedAt).toEqual(T0);

    await authenticateBot(header, at(60_000));
    expect(tokenUpdate).toHaveBeenCalledTimes(2);
    expect(db.tokens[0].lastUsedAt).toEqual(at(60_000));
  });
});
