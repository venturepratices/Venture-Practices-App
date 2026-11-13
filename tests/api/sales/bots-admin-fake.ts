import bcrypt from "bcryptjs";
import { vi } from "vitest";

// A fake database for the admin Bots routes: bots, people, pipelines, the
// history log, rate counters and notifications. Loaded by the route tests with
// vi.mock("@/lib/prisma", async () => (await import("./bots-admin-fake")).prismaModule).

type Row = Record<string, unknown>;

export const ADMIN_PASSWORD = "correct horse battery";
const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 4);

export const fake = {
  bots: [] as Row[],
  audits: [] as Row[],
  usage: [] as Row[],
  notifications: [] as Row[],
  salesMembers: new Set(["p1", "p2", "p3"]),
  reset() {
    this.bots = [];
    this.audits = [];
    this.usage = [];
    this.notifications = [];
  },
};

const people: Record<string, string> = { p1: "Ben E.", p2: "Sarah K.", p3: "DJ" };

function shape(row: Row, select?: Row): Row {
  const full: Row = { ...row, actingFor: { id: row.actingForId, name: people[row.actingForId as string] ?? "?" } };
  return select ? Object.fromEntries(Object.keys(select).map((key) => [key, full[key]])) : full;
}

const gone = () => Object.assign(new Error("No record was found."), { code: "P2025" });

const botToken = {
  findMany: async (args: { select?: Row } = {}) => fake.bots.map((row) => shape(row, args.select)),
  findUnique: async (args: { where: { id: string }; select?: Row }) => {
    const row = fake.bots.find((b) => b.id === args.where.id);
    return row ? shape(row, args.select) : null;
  },
  count: async (args: { where?: Row } = {}) =>
    fake.bots.filter((b) => !args.where?.actingForId || b.actingForId === args.where.actingForId).length,
  create: async (args: { data: Row; select?: Row }) => {
    const row: Row = {
      id: `b${fake.bots.length + 1}`,
      enabled: true,
      createdAt: new Date("2026-11-13T09:00:00.000Z"),
      lastUsedAt: null,
      rotatedAt: null,
      mustRotate: false,
      offReason: null,
      offAt: null,
      lastUsedIp: null,
      ...args.data,
    };
    fake.bots.push(row);
    return shape(row, args.select);
  },
  update: async (args: { where: { id: string }; data: Row; select?: Row }) => {
    const row = fake.bots.find((b) => b.id === args.where.id);
    if (!row) throw gone();
    Object.assign(row, Object.fromEntries(Object.entries(args.data).filter(([, v]) => v !== undefined)));
    return shape(row, args.select);
  },
  delete: async (args: { where: { id: string } }) => {
    const row = fake.bots.find((b) => b.id === args.where.id);
    if (!row) throw gone();
    fake.bots = fake.bots.filter((b) => b !== row);
    return row;
  },
};

export const prismaFake = {
  botToken,
  teamMember: {
    findFirst: async (args: { where: { id: string } }) => (fake.salesMembers.has(args.where.id) ? { id: args.where.id } : null),
    findUnique: async (args: { where: { id: string } }) =>
      args.where.id === "admin1" ? { id: "admin1", passwordHash: ADMIN_HASH } : null,
    findMany: async (args: { where?: Row } = {}) =>
      args.where?.isAdmin
        ? [{ id: "admin1" }, { id: "admin2" }]
        : [...fake.salesMembers].map((id) => ({ id, name: people[id] })),
  },
  salesPipeline: {
    findMany: async (args: { where?: { key?: { in: string[] } } } = {}) => {
      const all = [
        { key: "direct-mail", name: "Direct Mail" },
        { key: "consulting", name: "Consulting" },
      ];
      return args.where?.key ? all.filter((p) => args.where!.key!.in.includes(p.key)) : all;
    },
  },
  salesAuditLog: {
    create: async (args: { data: Row }) => fake.audits.push({ ...args.data, at: new Date() }),
    findMany: vi.fn(async (args: { where: Row; take?: number }) =>
      fake.audits.filter((a) => a.botTokenId === args.where.botTokenId).slice(0, args.take ?? 1000),
    ),
  },
  botTokenUsage: { findMany: async () => fake.usage },
  notification: {
    createMany: async (args: { data: Row[] }) => {
      fake.notifications.push(...args.data);
      return { count: args.data.length };
    },
  },
  $transaction: async (fn: (tx: unknown) => unknown) => fn(prismaFake),
};

export const prismaModule = { prisma: prismaFake };
