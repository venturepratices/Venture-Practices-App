import { vi } from "vitest";

// A small in-memory stand-in for the bot tables, the call log, notifications
// and the history log, so the key check runs for real without a database.
// Test files load it with: vi.mock("@/lib/prisma", async () => (await import("./bot-fake-db")).prismaModule)

export type FakeToken = {
  id: string;
  name: string;
  tokenHash: string;
  enabled: boolean;
  scopes: string[];
  pipelineKeys: string[];
  allPipelines: boolean;
  ownDealsOnly: boolean;
  mustRotate: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  knownIps: string[];
  offReason: string | null;
  offAt: Date | null;
  actingForId: string;
  actingFor: { id: string; isAdmin: boolean; canUseSales: boolean; salesSeesAllDeals: boolean };
};

type Row = Record<string, unknown>;
type UsageKey = { tokenId: string; kind: string; windowStart: Date };
const usageKey = (k: UsageKey) => `${k.tokenId}|${k.kind}|${k.windowStart.toISOString()}`;

export const fake = {
  tokens: [] as FakeToken[],
  usage: new Map<string, number>(),
  calls: [] as Row[],
  notifications: [] as Row[],
  audits: [] as Row[],
  admins: [{ id: "admin1" }, { id: "admin2" }],
  reset() {
    this.tokens = [];
    this.usage.clear();
    this.calls = [];
    this.notifications = [];
    this.audits = [];
  },
  usageCount(tokenId: string, kind: string): number {
    let total = 0;
    for (const [key, count] of this.usage) if (key.startsWith(`${tokenId}|${kind}|`)) total += count;
    return total;
  },
};

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

const botToken = {
  findUnique: async (args: { where: { tokenHash?: string; id?: string } }) =>
    fake.tokens.find((t) => (args.where.tokenHash ? t.tokenHash === args.where.tokenHash : t.id === args.where.id)) ?? null,
  updateMany: vi.fn(async (args: { where: Row; data: Partial<FakeToken> }) => {
    const hits = fake.tokens.filter((t) => matches(t as unknown as Row, args.where));
    for (const token of hits) Object.assign(token, args.data);
    return { count: hits.length };
  }),
};

const botTokenUsage = {
  upsert: vi.fn(async (args: { where: { tokenId_kind_windowStart: UsageKey }; update?: { count: { increment: number } } }) => {
    const key = usageKey(args.where.tokenId_kind_windowStart);
    const count = (fake.usage.get(key) ?? 0) + (args.update?.count.increment ?? 1);
    fake.usage.set(key, count);
    return { count };
  }),
  update: vi.fn(async () => {
    throw Object.assign(new Error("P2025"), { code: "P2025" });
  }),
  deleteMany: vi.fn(async () => ({ count: 0 })),
};

const botCallLog = {
  create: vi.fn(async (args: { data: Row }) => {
    fake.calls.push(args.data);
    return args.data;
  }),
  count: async (args: { where: Row & { at?: { gte: Date } } }) =>
    fake.calls.filter(
      (c) =>
        c.tokenId === args.where.tokenId &&
        (args.where.status === undefined || c.status === args.where.status) &&
        (!args.where.at || (c.at as Date) >= args.where.at.gte),
    ).length,
};

const salesAuditLog = {
  create: async (args: { data: Row }) => {
    fake.audits.push(args.data);
    return args.data;
  },
};

export const prismaFake = {
  botToken,
  botTokenUsage,
  botCallLog,
  salesAuditLog,
  teamMember: { findMany: async () => fake.admins },
  notification: {
    createMany: vi.fn(async (args: { data: Row[] }) => {
      fake.notifications.push(...args.data);
      return { count: args.data.length };
    }),
  },
  $transaction: async (fn: (tx: unknown) => unknown) => fn(prismaFake),
};

export const prismaModule = { prisma: prismaFake };
