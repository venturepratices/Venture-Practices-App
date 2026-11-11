import { beforeEach, describe, expect, it, vi } from "vitest";

// mentionsOrNames() lets a route @-mention people in Slack while only ever
// holding their id and name: it reads each person's email and Slack id
// itself, so those never have to travel in an API response.

const findManyMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { teamMember: { findMany: (...args: unknown[]) => findManyMock(...args), update: vi.fn() } },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const { mentionsOrNames } = await import("@/lib/slack");

beforeEach(() => {
  findManyMock.mockReset();
  vi.stubEnv("SLACK_BOT_TOKEN", "");
});

describe("mentionsOrNames", () => {
  it("mentions people with a known Slack id and falls back to the name for the rest, in the order given", async () => {
    findManyMock.mockResolvedValue([
      { id: "m2", email: "bob@example.com", slackUserId: null },
      { id: "m1", email: "ann@example.com", slackUserId: "U0ANN" },
    ]);

    const result = await mentionsOrNames([
      { id: "m1", name: "Ann" },
      { id: "m2", name: "Bob" },
    ]);

    expect(result).toEqual(["<@U0ANN>", "Bob"]);
    expect(findManyMock.mock.calls[0][0].where).toEqual({ id: { in: ["m1", "m2"] } });
  });

  it("uses the name of someone who is no longer on the team", async () => {
    findManyMock.mockResolvedValue([]);

    expect(await mentionsOrNames([{ id: "gone", name: "Former Teammate" }])).toEqual(["Former Teammate"]);
  });

  it("skips the database when there is nobody to mention", async () => {
    expect(await mentionsOrNames([])).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
