import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The password re-check on the Bots routes cannot be guessed at: 5 wrong tries
// in 15 minutes lock that admin out of it for 15 minutes, even with the right
// password. A right password clears the count. Counted per admin.

const requireAdminMock = vi.fn();
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, requireAdmin: () => requireAdminMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", async () => (await import("./bots-admin-fake")).prismaModule);

const { fake, ADMIN_PASSWORD } = await import("./bots-admin-fake");
const { resetPasswordStrikes } = await import("@/lib/sales/bot-admin-checks");
const listRoute = await import("@/app/api/sales/bots/route");
const botRoute = await import("@/app/api/sales/bots/[botId]/route");

type Row = Record<string, unknown>;
const LOCKED = "Too many wrong passwords. Try again in 15 minutes.";
const req = (method: string, body?: unknown, url = "http://localhost/api/sales/bots") =>
  new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (botId: string) => ({ params: Promise.resolve({ botId }) });
const create = async (password: string, body: Row = {}) => {
  const res = await listRoute.POST(req("POST", { name: "Muse", actingForId: "p1", role: "read", allPipelines: true, password, ...body }));
  return { status: res.status, body: (await res.json()) as Row };
};
const rotate = (password: string) =>
  botRoute.POST(req("POST", { password }, "http://localhost/api/sales/bots/b1?action=rotate"), ctx("b1"));
const patch = (body: Row) => botRoute.PATCH(req("PATCH", body), ctx("b1"));

beforeEach(() => {
  fake.reset();
  resetPasswordStrikes();
  vi.stubEnv("SALES_BOTS_ENABLED", "true");
  requireAdminMock.mockReset().mockResolvedValue({ userId: "admin1", isAdmin: true });
});
afterEach(() => vi.unstubAllEnvs());

async function fiveWrong() {
  for (let i = 0; i < 5; i += 1) expect((await create("nope")).status).toBe(403);
}

describe("password re-check lockout", () => {
  it("refuses even the right password after 5 wrong tries", async () => {
    await fiveWrong();
    const right = await create(ADMIN_PASSWORD);
    expect(right.status).toBe(429);
    expect(right.body.error).toBe(LOCKED);
    expect(fake.bots).toHaveLength(0);
  });

  it("locks rotate, turn-on, expiry and widening too", async () => {
    expect((await create(ADMIN_PASSWORD)).status).toBe(201);
    await patch({ enabled: false });
    await fiveWrong();
    expect((await rotate(ADMIN_PASSWORD)).status).toBe(429);
    expect((await patch({ enabled: true, password: ADMIN_PASSWORD })).status).toBe(429);
    expect((await patch({ expiresInDays: 30, password: ADMIN_PASSWORD })).status).toBe(429);
    expect((await patch({ role: "rep", password: ADMIN_PASSWORD })).status).toBe(429);
  });

  it("counts per admin", async () => {
    await fiveWrong();
    requireAdminMock.mockResolvedValue({ userId: "admin2", isAdmin: true });
    // admin2 has no password in the fake, so a wrong answer, but not a lock.
    expect((await create("anything")).status).toBe(403);
  });

  it("a right password clears the count", async () => {
    for (let i = 0; i < 4; i += 1) await create("nope");
    expect((await create(ADMIN_PASSWORD)).status).toBe(201);
    for (let i = 0; i < 4; i += 1) await create("nope", { actingForId: "p2" });
    expect((await create(ADMIN_PASSWORD, { actingForId: "p2" })).status).toBe(201);
  });

  it("lets the admin try again after 15 minutes", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-13T10:00:00.000Z"), toFake: ["Date"] });
    await fiveWrong();
    vi.setSystemTime(new Date("2026-11-13T10:16:00.000Z"));
    expect((await create(ADMIN_PASSWORD)).status).toBe(201);
    vi.useRealTimers();
  });
});
