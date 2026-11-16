import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A distinctive fake key goes through every Bots route and the screen's data.
// It may appear in the create and rotate answers only, and nowhere else.

const requireAdminMock = vi.fn();
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, requireAdmin: () => requireAdminMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", async () => (await import("./bots-admin-fake")).prismaModule);

const SECRETS = ["vpb_ZZDISTINCTIVEFAKESECRETONEZZ0000000000000001", "vpb_ZZDISTINCTIVEFAKESECRETTWOZZ0000000000000002"];
let next = 0;
vi.mock("@/lib/sales/bot-tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/bot-tokens")>();
  return {
    ...actual,
    generateBotSecret: () => {
      const secret = SECRETS[next++ % SECRETS.length];
      return { secret, hash: actual.hashBotSecret(secret), last4: secret.slice(-4) };
    },
  };
});

const { fake, ADMIN_PASSWORD } = await import("./bots-admin-fake");
const listRoute = await import("@/app/api/sales/bots/route");
const botRoute = await import("@/app/api/sales/bots/[botId]/route");
const activityRoute = await import("@/app/api/sales/bots/[botId]/activity/route");
const { loadBotsScreen } = await import("@/lib/sales/bots-screen");
const { PermissionError } = await import("@/lib/permissions");

type Row = Record<string, unknown>;
const req = (method: string, body?: unknown, url = "http://localhost/api/sales/bots") =>
  new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (botId: string) => ({ params: Promise.resolve({ botId }) });
const text = async (res: Response) => res.text();
const leaks = (body: string) => SECRETS.some((s) => body.includes(s) || body.includes(s.slice(4, 30)));

beforeEach(() => {
  fake.reset();
  next = 0;
  vi.stubEnv("SALES_BOTS_ENABLED", "true");
  requireAdminMock.mockReset().mockResolvedValue({ userId: "admin1", isAdmin: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("where the key may appear", () => {
  it("only in the create and rotate answers", async () => {
    const created = await text(await listRoute.POST(req("POST", { name: "Muse", actingForId: "p1", role: "read", allPipelines: true, password: ADMIN_PASSWORD })));
    expect(created).toContain(SECRETS[0]);

    const bodies = [
      await text(await listRoute.GET()),
      await text(await botRoute.PATCH(req("PATCH", { role: "helper" }), ctx("b1"))),
      await text(await activityRoute.GET(req("GET"), ctx("b1"))),
      JSON.stringify(await loadBotsScreen()),
      JSON.stringify(fake.audits),
      JSON.stringify(fake.notifications),
    ];
    for (const body of bodies) expect(leaks(body)).toBe(false);

    const rotated = await text(await botRoute.POST(req("POST", { password: ADMIN_PASSWORD }, "http://localhost/api/sales/bots/b1?action=rotate"), ctx("b1")));
    expect(rotated).toContain(SECRETS[1]);
    expect(rotated).not.toContain(SECRETS[0]);
    expect(leaks(await text(await botRoute.DELETE(req("DELETE"), ctx("b1"))))).toBe(false);
    expect(leaks(JSON.stringify(fake.audits))).toBe(false);
  });
});

describe("admin only", () => {
  it.each([
    [401, "Sign in first."],
    [403, "This action is for admins only."],
  ])("refuses the activity and delete routes with %i", async (status, message) => {
    requireAdminMock.mockRejectedValue(new PermissionError(status as 401 | 403, message));
    expect((await activityRoute.GET(req("GET"), ctx("b1"))).status).toBe(status);
    expect((await botRoute.DELETE(req("DELETE"), ctx("b1"))).status).toBe(status);
  });
});

describe("DELETE /api/sales/bots/[botId]", () => {
  it("deletes the bot and keeps a history row", async () => {
    await listRoute.POST(req("POST", { name: "Muse", actingForId: "p1", role: "read", allPipelines: true, password: ADMIN_PASSWORD }));
    const res = await botRoute.DELETE(req("DELETE"), ctx("b1"));
    expect(res.status).toBe(200);
    expect(fake.bots).toHaveLength(0);
    expect(fake.audits.at(-1)).toMatchObject({ entityType: "BotToken", entityId: "b1", action: "deleted" });
    expect((await botRoute.DELETE(req("DELETE"), ctx("b1"))).status).toBe(404);
  });

  it("refuses another site's request", async () => {
    const res = await botRoute.DELETE(
      new Request("http://localhost/api/sales/bots/b1", { method: "DELETE", headers: { origin: "https://evil.example", host: "localhost" } }),
      ctx("b1"),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/sales/bots/[botId]/activity", () => {
  it("gives the bot's last 20 history rows, newest first, without what changed inside", async () => {
    await listRoute.POST(req("POST", { name: "Muse", actingForId: "p1", role: "read", allPipelines: true, password: ADMIN_PASSWORD }));
    for (let i = 0; i < 25; i += 1) {
      fake.audits.push({ id: `a${i}`, botTokenId: "b1", entityType: "SalesDeal", entityId: `d${i}`, action: "note_added", at: new Date(), after: { body: "<b>hi</b>" } });
    }
    fake.audits.push({ id: "z", botTokenId: "b1", entityType: "BotToken", entityId: "b1", action: "auto_turned_off", at: new Date(), after: { offReason: "it went over its call limit." } });
    const res = await activityRoute.GET(req("GET"), ctx("b1"));
    const body = (await res.json()) as { activity: Row[] };
    expect(res.status).toBe(200);
    expect(body.activity.length).toBeLessThanOrEqual(20);
    expect(body.activity[0]).toEqual({ id: "a0", at: expect.any(String), action: "note_added", entityType: "SalesDeal", entityId: "d0", detail: null });
    expect(JSON.stringify(body)).not.toContain("<b>hi</b>");
  });

  it("gives 404 for an unknown bot", async () => {
    expect((await activityRoute.GET(req("GET"), ctx("nope"))).status).toBe(404);
  });
});

describe("loadBotsScreen", () => {
  it("counts only today's calls and lists Sales members and pipelines", async () => {
    await listRoute.POST(req("POST", { name: "Muse", actingForId: "p1", role: "read", allPipelines: true, password: ADMIN_PASSWORD }));
    fake.usage = [{ tokenId: "b1", count: 42 }];
    const data = await loadBotsScreen(new Date("2026-11-13T12:00:00.000Z"));
    expect(data.bots[0]).toMatchObject({ id: "b1", name: "Muse", callsToday: 42, keyLast4: SECRETS[0].slice(-4), actingFor: { name: "Ben E." } });
    expect(data.members.map((m) => m.id)).toEqual(["p1", "p2", "p3"]);
    expect(data.pipelines).toEqual([{ key: "direct-mail", name: "Direct Mail" }, { key: "consulting", name: "Consulting" }]);
    expect(data).toMatchObject({ botsEnabled: true, now: "2026-11-13T12:00:00.000Z" });
  });
});
