import { beforeEach, describe, expect, it, vi } from "vitest";

// requireSalesActor: the one gate every Sales route calls. A request with a
// bearer key goes through the bot key check (with the route's permission); any
// other request is a signed-in person. Plus the pipeline rules for bots.

const authenticateBotMock = vi.fn();
vi.mock("@/lib/sales/bot-tokens", () => ({ authenticateBot: (...args: unknown[]) => authenticateBotMock(...args) }));
const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { requireSalesActor } = await import("@/lib/sales/actor");
const { botPipelineFilter, dealPipelineWhere } = await import("@/lib/sales/access");
const { visibleDealWhere } = await import("@/lib/sales/deal-access");
const { PermissionError } = await import("@/lib/permissions");

const BOT = { userId: "p1", isAdmin: false, seesAllDeals: false, via: "bot" as const, botTokenId: "b1", scopes: ["read"], pipelineKeys: ["direct-mail"], allPipelines: false };
const PERSON = { userId: "u1", isAdmin: false, seesAllDeals: true, via: "user" as const };
const KEY = "vpb_" + "a".repeat(43);

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/sales/deals?x=1", { method: "GET", headers: { "x-forwarded-for": "203.0.113.7", "user-agent": "Muse/1.0", ...headers } });

beforeEach(() => {
  authenticateBotMock.mockReset().mockResolvedValue({ ok: true, actor: BOT });
  requireSalesUserMock.mockReset().mockResolvedValue(PERSON);
});

describe("requireSalesActor", () => {
  it("treats a request without a bearer key as a signed-in person", async () => {
    await expect(requireSalesActor(request(), "read")).resolves.toEqual(PERSON);
    expect(authenticateBotMock).not.toHaveBeenCalled();
  });

  it("sends a bearer key through the bot key check with the route's permission, path and address", async () => {
    await expect(requireSalesActor(request({ authorization: `Bearer ${KEY}` }), "read")).resolves.toEqual(BOT);
    expect(requireSalesUserMock).not.toHaveBeenCalled();
    expect(authenticateBotMock).toHaveBeenCalledWith(`Bearer ${KEY}`, expect.any(Date), {
      method: "GET",
      path: "/api/sales/deals",
      ip: "203.0.113.7",
      userAgent: "Muse/1.0",
      scope: "read",
    });
  });

  it("never falls back to the signed-in person when a bearer key is refused", async () => {
    authenticateBotMock.mockResolvedValue({ ok: false, status: 401, error: "Invalid bot key." });
    const failure = requireSalesActor(request({ authorization: "Bearer nonsense" }), "read");
    await expect(failure).rejects.toBeInstanceOf(PermissionError);
    await expect(failure).rejects.toMatchObject({ status: 401, message: "Invalid bot key." });
    expect(requireSalesUserMock).not.toHaveBeenCalled();
  });

  it("passes null for a route bots may never use, so the check refuses it", async () => {
    authenticateBotMock.mockResolvedValue({ ok: false, status: 403, error: "This bot is not allowed to do that." });
    await expect(requireSalesActor(request({ authorization: `Bearer ${KEY}` }), null)).rejects.toMatchObject({ status: 403 });
    expect(authenticateBotMock.mock.calls[0][2]).toMatchObject({ scope: null });
  });
});

describe("pipeline rules for bots", () => {
  it("limit a bot to its picked pipelines, and an empty list to none", () => {
    expect(botPipelineFilter(BOT)).toEqual({ key: { in: ["direct-mail"] } });
    expect(botPipelineFilter({ ...BOT, pipelineKeys: [] })).toEqual({ key: { in: [] } });
    expect(dealPipelineWhere(BOT)).toEqual({ pipeline: { key: { in: ["direct-mail"] } } });
  });

  it("do not limit an all-pipelines bot or a person", () => {
    expect(botPipelineFilter({ ...BOT, allPipelines: true })).toEqual({});
    expect(botPipelineFilter(PERSON)).toEqual({});
    expect(dealPipelineWhere(PERSON)).toEqual({});
  });

  it("treat a bot with no pipeline setting at all as allowed none", () => {
    expect(botPipelineFilter({ ...BOT, pipelineKeys: undefined, allPipelines: undefined })).toEqual({ key: { in: [] } });
  });

  it("are part of every one-deal lookup", () => {
    expect(visibleDealWhere(BOT, "d1")).toEqual({
      id: "d1",
      archivedAt: null,
      ownerId: "p1",
      pipeline: { key: { in: ["direct-mail"] } },
    });
  });
});

describe("the deals list for a bot", async () => {
  const { boardDealWhere } = await import("@/lib/sales/board");
  const { parseBoardQuery } = await import("@/lib/sales/board-query");

  it("adds the bot's pipelines to the deals list filter", () => {
    const where = boardDealWhere(BOT, parseBoardQuery({}), "p1", new Date("2026-11-13T12:00:00.000Z"));
    expect(where).toMatchObject({ pipelineId: "p1", ownerId: "p1", pipeline: { key: { in: ["direct-mail"] } } });
  });
});
