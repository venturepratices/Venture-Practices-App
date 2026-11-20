import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The daily call refresh. Robert's weekly call numbers and the global Calls
// page read from a table that is only filled by the sync, and nothing ran the
// sync unless someone opened a client's tab. This job runs it for everyone.

const syncCallsForAllConnectedClients = vi.hoisted(() => vi.fn());
vi.mock("@/lib/highlevel", () => ({
  syncCallsForAllConnectedClients: (...args: unknown[]) => syncCallsForAllConnectedClients(...args),
}));

const route = await import("@/app/api/cron/highlevel-calls-sync/route");

const SECRET = "test-cron-secret-value";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/highlevel-calls-sync", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/cron/highlevel-calls-sync", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    syncCallsForAllConnectedClients.mockReset();
  });

  it("refuses a request with no secret, and does not sync", async () => {
    const res = await route.GET(request());
    expect(res.status).toBe(401);
    expect(syncCallsForAllConnectedClients).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    const res = await route.GET(request("Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(syncCallsForAllConnectedClients).not.toHaveBeenCalled();
  });

  it("refuses everything when CRON_SECRET is not set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await route.GET(request("Bearer "));
    expect(res.status).toBe(401);
    expect(syncCallsForAllConnectedClients).not.toHaveBeenCalled();
  });

  it("syncs every client and reports the count", async () => {
    syncCallsForAllConnectedClients.mockResolvedValue({ clients: 3, synced: 3, failures: [] });
    const res = await route.GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, clients: 3, synced: 3, failures: [] });
  });

  it("one client failing still answers 200 and lists the failure", async () => {
    syncCallsForAllConnectedClients.mockResolvedValue({
      clients: 3,
      synced: 2,
      failures: [{ clientId: "belmont", error: "HighLevel refused the token (401)." }],
    });
    const res = await route.GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.failures).toHaveLength(1);
  });

  it("every client failing is a failed run", async () => {
    syncCallsForAllConnectedClients.mockResolvedValue({
      clients: 2,
      synced: 0,
      failures: [
        { clientId: "a", error: "x" },
        { clientId: "b", error: "y" },
      ],
    });
    const res = await route.GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
  });

  it("no connected clients is a quiet success", async () => {
    syncCallsForAllConnectedClients.mockResolvedValue({ clients: 0, synced: 0, failures: [] });
    const res = await route.GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
  });

  it("an unexpected crash answers 500 without leaking the error", async () => {
    syncCallsForAllConnectedClients.mockRejectedValue(new Error("password=hunter2"));
    const res = await route.GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
  });
});
