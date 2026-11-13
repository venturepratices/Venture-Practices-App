import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Offboarding: when a person loses Sales access (and is not an admin), every
// bot that works for them is turned off at once, with the reason kept.

vi.mock("@/lib/prisma", async () => (await import("./bot-fake-db")).prismaModule);

const { fake } = await import("./bot-fake-db");
const { turnOffBotsWithoutAccess } = await import("@/lib/sales/bot-offboarding");

const T0 = new Date("2026-11-13T10:00:00.000Z");
const bot = (id: string, actingForId: string, enabled = true) =>
  ({ id, name: id, actingForId, enabled, offReason: null, offAt: null }) as unknown as (typeof fake.tokens)[number];

beforeEach(() => fake.reset());

describe("turnOffBotsWithoutAccess", () => {
  it("turns off every bot of a person who lost access", async () => {
    fake.tokens.push(bot("b1", "p1"), bot("b2", "p1"), bot("b3", "p2"));
    await turnOffBotsWithoutAccess({ id: "p1", isAdmin: false, canUseSales: false }, T0);
    expect(fake.tokens.map((t) => [t.id, t.enabled])).toEqual([["b1", false], ["b2", false], ["b3", true]]);
    expect(fake.tokens[0]).toMatchObject({ offReason: expect.stringContaining("lost access"), offAt: T0 });
  });

  it("leaves bots alone while the person still has access", async () => {
    fake.tokens.push(bot("b1", "p1"));
    await turnOffBotsWithoutAccess({ id: "p1", isAdmin: false, canUseSales: true }, T0);
    await turnOffBotsWithoutAccess({ id: "p1", isAdmin: true, canUseSales: false }, T0);
    expect(fake.tokens[0].enabled).toBe(true);
  });

  it("is called when a team member is saved", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/actions/team-members.ts"), "utf8");
    expect(source).toMatch(/await turnOffBotsWithoutAccess\(member\)/);
  });
});
