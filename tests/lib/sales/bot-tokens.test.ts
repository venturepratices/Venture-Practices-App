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
type UsageWhere = { where: { tokenId_kind_windowStart: UsageKey } };

/** What Prisma throws for a failed query: an error carrying a P-code. */
const prismaError = (code: string) => Object.assign(new Error(`Prisma error ${code}`), { code });

const usageDeleteMany = vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 0 }));
// Like Prisma's updateMany: no error when the key is gone, just a count of 0.
const tokenUpdateMany = vi.fn(async (args: { where: { id: string }; data: Partial<FakeToken> }) => {
  const token = db.tokens.find((t) => t.id === args.where.id);
  if (token) Object.assign(token, args.data);
  return { count: token ? 1 : 0 };
});
const usageUpsert = vi.fn(async (args: UsageWhere & { create: UsageKey }) => {
  const key = usageKey(args.where.tokenId_kind_windowStart);
  const count = (db.usage.get(key) ?? 0) + 1;
  db.usage.set(key, count);
  return { count };
});
// Like Prisma's update: P2025 when there is no row to update.
const usageUpdate = vi.fn(async (args: UsageWhere & { data: unknown }) => {
  const key = usageKey(args.where.tokenId_kind_windowStart);
  const current = db.usage.get(key);
  if (current === undefined) throw prismaError("P2025");
  db.usage.set(key, current + 1);
  return { count: current + 1 };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    botToken: {
      findUnique: async (args: { where: { tokenHash: string } }) =>
        db.tokens.find((t) => t.tokenHash === args.where.tokenHash) ?? null,
      updateMany: (args: { where: { id: string }; data: Partial<FakeToken> }) => tokenUpdateMany(args),
    },
    botTokenUsage: {
      upsert: (args: UsageWhere & { create: UsageKey }) => usageUpsert(args),
      update: (args: UsageWhere & { data: unknown }) => usageUpdate(args),
      deleteMany: (args: unknown) => usageDeleteMany(args),
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
  // mockReset also drops any one-off failure a test queued, back to the fakes above.
  tokenUpdateMany.mockReset();
  usageUpsert.mockReset();
  usageUpdate.mockReset();
  usageDeleteMany.mockReset();
});

/** Nothing was counted against the key and lastUsedAt was not touched. */
function expectNoBookkeeping() {
  expect(usageUpsert).not.toHaveBeenCalled();
  expect(db.usage.size).toBe(0);
  expect(tokenUpdateMany).not.toHaveBeenCalled();
  expect(usageDeleteMany).not.toHaveBeenCalled();
  for (const token of db.tokens) expect(token.lastUsedAt).toBeNull();
}

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
    const helper = {
      userId: "p1",
      isAdmin: false,
      seesAllDeals: true,
      via: "bot" as const,
      botTokenId: "bot1",
      scopes: BOT_ROLE_PRESETS.helper,
    };
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
    addToken();
    const missing = await authenticateBot(null, T0);
    const unknown = await authenticateBot(`Bearer ${generateBotSecret().secret}`, T0);
    expect(unknown).toMatchObject({ ok: false, status: 401 });
    expect(!unknown.ok && unknown.error).toBe(!missing.ok && missing.error);
    expectNoBookkeeping();
  });

  it("rejects a turned-off key (401) without counting the call or stamping lastUsedAt", async () => {
    const header = addToken({ enabled: false });
    await expect(authenticateBot(header, T0)).resolves.toEqual({
      ok: false,
      status: 401,
      error: "This bot is turned off.",
    });
    expectNoBookkeeping();
  });

  it("stops at once when the person it works for loses Sales access (403), without counting the call", async () => {
    const header = addToken({}, { canUseSales: false, isAdmin: false });
    await expect(authenticateBot(header, T0)).resolves.toMatchObject({ ok: false, status: 403 });
    expectNoBookkeeping();
  });

  it("works for an admin even with the Sales switch off, but never as an admin", async () => {
    const header = addToken({}, { canUseSales: false, isAdmin: true, salesSeesAllDeals: true });
    const result = await authenticateBot(header, T0);
    expect(result).toMatchObject({ ok: true, actor: { userId: "p1", isAdmin: false, seesAllDeals: true, via: "bot" } });
  });

  it("accepts the Bearer scheme in any letter case, but the key itself must match exactly", async () => {
    const header = addToken();
    const secret = header.slice("Bearer ".length);
    for (const scheme of ["bearer", "BEARER", "bEaReR"]) {
      expect((await authenticateBot(`${scheme} ${secret}`, at(1000))).ok, scheme).toBe(true);
    }
    await expect(authenticateBot(`Bearer ${secret.replace("vpb_", "VPB_")}`, T0)).resolves.toMatchObject({
      ok: false,
      status: 401,
      error: "Invalid bot key.",
    });
    await expect(authenticateBot(`Bearer ${secret.slice(0, -1)}`, T0)).resolves.toMatchObject({ ok: false, status: 401 });
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

  it("writes lastUsedAt at most once a minute, with updateMany", async () => {
    const header = addToken();
    await authenticateBot(header, T0);
    await authenticateBot(header, at(30_000));
    await authenticateBot(header, at(59_999));
    expect(tokenUpdateMany).toHaveBeenCalledTimes(1);
    expect(tokenUpdateMany).toHaveBeenCalledWith({ where: { id: "bot1" }, data: { lastUsedAt: T0 } });
    expect(db.tokens[0].lastUsedAt).toEqual(T0);

    await authenticateBot(header, at(60_000));
    expect(tokenUpdateMany).toHaveBeenCalledTimes(2);
    expect(db.tokens[0].lastUsedAt).toEqual(at(60_000));
  });
});

describe("authenticateBot bookkeeping", () => {
  const minuteKey = (tokenId: string, now: Date) =>
    usageKey({ tokenId, kind: "minute", windowStart: new Date(Math.floor(now.getTime() / 60_000) * 60_000) });

  it("counts both of two first calls in a new window when they race to create its counter", async () => {
    const header = addToken();
    // Another call creates this window's counter after our upsert looked for it: our insert hits the unique key.
    usageUpsert.mockImplementationOnce(async (args) => {
      db.usage.set(usageKey(args.where.tokenId_kind_windowStart), 1);
      throw prismaError("P2002");
    });

    await expect(authenticateBot(header, T0)).resolves.toMatchObject({ ok: true });

    expect(usageUpdate).toHaveBeenCalledTimes(1);
    expect(usageUpdate).toHaveBeenCalledWith({
      where: { tokenId_kind_windowStart: { tokenId: "bot1", kind: "minute", windowStart: T0 } },
      data: { count: { increment: 1 } },
      select: { count: true },
    });
    expect(db.usage.get(minuteKey("bot1", T0))).toBe(2);
  });

  it("still enforces the limit on a call counted after such a race", async () => {
    const header = addToken();
    db.usage.set(minuteKey("bot1", T0), BOT_LIMITS.perMinute);
    usageUpsert.mockImplementationOnce(async () => {
      throw prismaError("P2002");
    });

    await expect(authenticateBot(header, T0)).resolves.toMatchObject({ ok: false, status: 429 });
  });

  it("gives the invalid-key 401 when the key is deleted before its call is counted", async () => {
    const header = addToken();
    usageUpsert.mockImplementationOnce(async () => {
      throw prismaError("P2003");
    });

    await expect(authenticateBot(header, T0)).resolves.toEqual({ ok: false, status: 401, error: "Invalid bot key." });
    expect(tokenUpdateMany).not.toHaveBeenCalled();
  });

  it("gives the invalid-key 401 when the key is deleted between losing the race and the retry", async () => {
    const header = addToken();
    usageUpsert.mockImplementationOnce(async () => {
      throw prismaError("P2002");
    });

    await expect(authenticateBot(header, T0)).resolves.toEqual({ ok: false, status: 401, error: "Invalid bot key." });
  });

  it("lets other counter errors through instead of hiding them", async () => {
    const header = addToken();
    usageUpsert.mockRejectedValueOnce(new Error("connection reset"));

    await expect(authenticateBot(header, T0)).rejects.toThrow("connection reset");
  });

  it("never fails an allowed call because lastUsedAt or the old-counter cleanup could not be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const header = addToken();
    tokenUpdateMany.mockRejectedValueOnce(new Error("connection reset"));
    usageDeleteMany.mockRejectedValueOnce(new Error("connection reset"));

    await expect(authenticateBot(header, T0)).resolves.toMatchObject({ ok: true });

    // The cleanup still ran after the lastUsedAt write failed.
    expect(usageDeleteMany).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("rate-limit counter cleanup", () => {
  it("clears the key's finished windows on the same once-a-minute beat", async () => {
    const header = addToken();
    await authenticateBot(header, T0);
    await authenticateBot(header, at(10_000));
    expect(usageDeleteMany).toHaveBeenCalledTimes(1);

    await authenticateBot(header, at(90_000));
    expect(usageDeleteMany).toHaveBeenCalledTimes(2);
    expect(usageDeleteMany).toHaveBeenLastCalledWith({
      where: {
        tokenId: "bot1",
        OR: [
          { kind: "minute", windowStart: { lt: at(60_000) } },
          { kind: "day", windowStart: { lt: new Date("2026-11-05T00:00:00.000Z") } },
        ],
      },
    });
  });
});
