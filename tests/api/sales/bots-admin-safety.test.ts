import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The safety rules on the admin Bots routes: a password check before a key is
// made, rotated or turned on; the pause switch; caps; expiry; pipelines that
// must be picked; and an in-app note to every admin. Fake database and admin.

const requireAdminMock = vi.fn();
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, requireAdmin: () => requireAdminMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", async () => (await import("./bots-admin-fake")).prismaModule);

const { fake, ADMIN_PASSWORD } = await import("./bots-admin-fake");
const listRoute = await import("@/app/api/sales/bots/route");
const botRoute = await import("@/app/api/sales/bots/[botId]/route");

type Row = Record<string, unknown>;
const DAY = 86_400_000;
const req = (method: string, body?: unknown, url = "http://localhost/api/sales/bots") =>
  new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (botId: string) => ({ params: Promise.resolve({ botId }) });
const NEW_BOT = { name: "Muse", actingForId: "p1", role: "read", allPipelines: true, password: ADMIN_PASSWORD };

async function create(body: Row = {}) {
  const res = await listRoute.POST(req("POST", { ...NEW_BOT, ...body }));
  return { res, body: (await res.json()) as Row };
}
const rotate = (botId: string, body: Row) =>
  botRoute.POST(req("POST", body, `http://localhost/api/sales/bots/${botId}?action=rotate`), ctx(botId));
const patch = (botId: string, body: Row) => botRoute.PATCH(req("PATCH", body), ctx(botId));

beforeEach(() => {
  fake.reset();
  vi.stubEnv("SALES_BOTS_ENABLED", "true");
  requireAdminMock.mockReset().mockResolvedValue({ userId: "admin1", isAdmin: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("password check", () => {
  it("refuses to make a key without the admin's password", async () => {
    expect((await create({ password: undefined })).res.status).toBe(400);
    const wrong = await create({ password: "nope" });
    expect(wrong.res.status).toBe(403);
    expect(wrong.body.error).toBe("That password is not right.");
    expect(fake.bots).toHaveLength(0);
  });

  it("refuses to rotate or turn on without it, but turning off needs none", async () => {
    await create();
    expect((await rotate("b1", { password: "nope" })).status).toBe(403);
    expect((await patch("b1", { enabled: false })).status).toBe(200);
    expect((await patch("b1", { enabled: true })).status).toBe(400);
    expect((await patch("b1", { enabled: true, password: "nope" })).status).toBe(403);
    expect((await patch("b1", { enabled: true, password: ADMIN_PASSWORD })).status).toBe(200);
  });
});

describe("pause switch", () => {
  it("refuses to make, rotate or turn on a key while bot keys are paused", async () => {
    await create();
    vi.stubEnv("SALES_BOTS_ENABLED", "false");
    const made = await create();
    expect(made.res.status).toBe(403);
    expect(made.body.error).toMatch(/paused/);
    expect((await rotate("b1", { password: ADMIN_PASSWORD })).status).toBe(403);
    await patch("b1", { enabled: false });
    expect((await patch("b1", { enabled: true, password: ADMIN_PASSWORD })).status).toBe(403);
  });
});

describe("expiry", () => {
  it("sets 90 days by default, or the days chosen, and never more than 90", async () => {
    const before = Date.now();
    await create();
    expect((fake.bots[0].expiresAt as Date).getTime()).toBeGreaterThanOrEqual(before + 90 * DAY);
    await create({ actingForId: "p2", expiresInDays: 30 });
    expect((fake.bots[1].expiresAt as Date).getTime()).toBeLessThan(before + 31 * DAY);
    expect((await create({ actingForId: "p3", expiresInDays: 91 })).res.status).toBe(400);
  });

  it("starts a new expiry on rotate and clears the must-rotate mark", async () => {
    await create({ expiresInDays: 7 });
    fake.bots[0].mustRotate = true;
    expect((await rotate("b1", { password: ADMIN_PASSWORD, expiresInDays: 60 })).status).toBe(200);
    expect((fake.bots[0].expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 59 * DAY);
    expect(fake.bots[0].mustRotate).toBe(false);
  });

  it("refuses to turn on a key restored from a backup until it is rotated", async () => {
    await create();
    Object.assign(fake.bots[0], { enabled: false, mustRotate: true });
    const res = await patch("b1", { enabled: true, password: ADMIN_PASSWORD });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Row).error).toMatch(/new key/);
  });
});

describe("pipelines and caps", () => {
  it("needs all pipelines or at least one picked: an empty list means none", async () => {
    expect((await create({ allPipelines: undefined })).res.status).toBe(400);
    expect((await create({ allPipelines: false, pipelineKeys: [] })).res.status).toBe(400);
    expect((await create({ allPipelines: false, pipelineKeys: ["direct-mail"] })).res.status).toBe(201);
    expect(fake.bots[0]).toMatchObject({ allPipelines: false, pipelineKeys: ["direct-mail"], ownDealsOnly: true });
  });

  it("refuses to leave a bot with no pipelines on an edit", async () => {
    await create();
    expect((await patch("b1", { allPipelines: false })).status).toBe(400);
    expect((await patch("b1", { allPipelines: false, pipelineKeys: ["consulting"] })).status).toBe(200);
  });

  it("allows at most 2 bots per person and 10 in total", async () => {
    await create();
    await create();
    const third = await create();
    expect(third.res.status).toBe(400);
    expect(third.body.error).toMatch(/2 bots/);
    fake.bots = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, actingForId: `other${i}` }));
    expect((await create({ actingForId: "p2" })).body.error).toMatch(/10 bots/);
  });
});

describe("admins are told, in the app", () => {
  it("on create, rotate and turn on", async () => {
    await create();
    await rotate("b1", { password: ADMIN_PASSWORD });
    await patch("b1", { enabled: false });
    await patch("b1", { enabled: true, password: ADMIN_PASSWORD });
    expect(fake.notifications).toHaveLength(6);
    expect(new Set(fake.notifications.map((n) => n.recipientId))).toEqual(new Set(["admin1", "admin2"]));
    expect(fake.notifications.every((n) => n.type === "BOT_ALERT")).toBe(true);
  });

  it("turning back on clears the reason the app turned it off", async () => {
    await create();
    Object.assign(fake.bots[0], { enabled: false, offReason: "it went over its call limit.", offAt: new Date() });
    await patch("b1", { enabled: true, password: ADMIN_PASSWORD });
    expect(fake.bots[0]).toMatchObject({ enabled: true, offReason: null, offAt: null });
  });
});

describe("more power needs the password, less power does not", () => {
  it.each([
    ["a new permission", { role: "rep" }],
    ["all pipelines", { allPipelines: true }],
    ["another pipeline", { pipelineKeys: ["direct-mail", "consulting"] }],
    ["everyone's deals", { ownDealsOnly: false }],
  ])("refuses %s without the password", async (_label, change) => {
    await create({ allPipelines: false, pipelineKeys: ["direct-mail"], role: "helper" });
    expect((await patch("b1", change)).status).toBe(400);
    expect((await patch("b1", { ...change, password: ADMIN_PASSWORD })).status).toBe(200);
  });

  it.each([
    ["fewer permissions", { role: "read" }],
    ["fewer pipelines", { pipelineKeys: ["direct-mail"] }],
    ["own deals only", { ownDealsOnly: true }],
  ])("allows %s without the password", async (_label, change) => {
    await create({ allPipelines: false, pipelineKeys: ["direct-mail", "consulting"], role: "helper", ownDealsOnly: false });
    expect((await patch("b1", change)).status).toBe(200);
  });
});

describe("key length choices", () => {
  it("accepts only 7, 30, 60 or 90 days", async () => {
    expect((await create({ expiresInDays: 45 })).res.status).toBe(400);
    expect((await create({ expiresInDays: 7 })).res.status).toBe(201);
    expect((await rotate("b1", { password: ADMIN_PASSWORD, expiresInDays: 45 })).status).toBe(400);
    expect((await patch("b1", { expiresInDays: 45, password: ADMIN_PASSWORD })).status).toBe(400);
  });
});
