import { beforeEach, describe, expect, it, vi } from "vitest";

// The daily bot job: trims the call log to 90 days and tells admins (in the
// app only) once when a key will expire within 7 days.

type Row = Record<string, unknown>;
const db = { bots: [] as Row[], notifications: [] as Row[] };
const deleteMany = vi.fn(async (_args: unknown) => ({ count: 3 }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    botCallLog: { deleteMany: (args: unknown) => deleteMany(args) },
    botToken: {
      findMany: async (args: { where: { expiresAt: { lte: Date; gt: Date } } }) =>
        db.bots.filter(
          (b) =>
            b.enabled &&
            b.expiryWarnedAt === null &&
            (b.expiresAt as Date) <= args.where.expiresAt.lte &&
            (b.expiresAt as Date) > args.where.expiresAt.gt,
        ),
      updateMany: async (args: { where: { id: string }; data: Row }) => {
        const bot = db.bots.find((b) => b.id === args.where.id);
        if (bot) Object.assign(bot, args.data);
        return { count: bot ? 1 : 0 };
      },
    },
    teamMember: { findMany: async () => [{ id: "admin1" }] },
    notification: {
      createMany: async (args: { data: Row[] }) => {
        db.notifications.push(...args.data);
        return { count: args.data.length };
      },
    },
  },
}));

const { runBotMaintenance } = await import("@/lib/sales/bot-maintenance");

const NOW = new Date("2026-11-13T04:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

beforeEach(() => {
  db.bots = [];
  db.notifications = [];
  deleteMany.mockClear();
});

describe("runBotMaintenance", () => {
  it("deletes call log rows older than 90 days", async () => {
    const result = await runBotMaintenance(NOW);
    expect(deleteMany).toHaveBeenCalledWith({ where: { at: { lt: days(-90) } } });
    expect(result.trimmed).toBe(3);
  });

  it("warns admins once about a key that expires within 7 days", async () => {
    db.bots.push(
      { id: "b1", name: "Muse", enabled: true, expiresAt: days(5), expiryWarnedAt: null },
      { id: "b2", name: "Later", enabled: true, expiresAt: days(20), expiryWarnedAt: null },
    );
    await runBotMaintenance(NOW);
    await runBotMaintenance(days(1));
    expect(db.notifications).toHaveLength(1);
    expect(db.notifications[0]).toMatchObject({ recipientId: "admin1", type: "BOT_ALERT", entityId: "b1" });
    expect(db.notifications[0].message).toContain("expires");
    expect(db.bots[0].expiryWarnedAt).toEqual(NOW);
  });
});
