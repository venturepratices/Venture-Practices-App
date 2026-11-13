import { beforeEach, describe, expect, it, vi } from "vitest";

// The daily cap on records a bot may read: counted per key per UTC day, and
// over the cap the read is refused before any data goes back. People are never counted.

vi.mock("@/lib/prisma", async () => (await import("./bot-fake-db")).prismaModule);
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { fake } = await import("./bot-fake-db");
const { chargeBotRows, BOT_ROWS_PER_DAY } = await import("@/lib/sales/actor");

const BOT = { userId: "p1", isAdmin: false, seesAllDeals: false, via: "bot" as const, botTokenId: "b1" };
const T0 = new Date("2026-11-13T10:00:00.000Z");

beforeEach(() => fake.reset());

describe("chargeBotRows", () => {
  it("counts the records a bot reads today", async () => {
    await chargeBotRows(BOT, 30, T0);
    await chargeBotRows(BOT, 12, T0);
    expect(fake.usageCount("b1", "rows")).toBe(42);
  });

  it(`refuses the read that would pass ${BOT_ROWS_PER_DAY} records in a day (429)`, async () => {
    await chargeBotRows(BOT, BOT_ROWS_PER_DAY, T0);
    await expect(chargeBotRows(BOT, 1, T0)).rejects.toMatchObject({ status: 429 });
  });

  it("never counts a signed-in person", async () => {
    await chargeBotRows({ userId: "u1", isAdmin: false, seesAllDeals: true, via: "user" }, 500, T0);
    expect(fake.usage.size).toBe(0);
  });
});
