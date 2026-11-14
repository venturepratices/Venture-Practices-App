import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The automatic Pipedrive sync cron. It drives the existing import engine as
// if an admin were pressing "Copy for real" in the browser, with the same
// safety rules: nothing runs when the master switch is off, no token, after
// the lock, or with no admin to attribute to; only one run goes at a time;
// a pause from Pipedrive stops the chunk, not the run.
//
// Nothing here reaches a real database, a real session or Pipedrive.

type Row = Record<string, unknown>;
type RunRow = {
  id: string;
  mode: "DRY_RUN" | "LIVE";
  isFinal: boolean;
  status: "RUNNING" | "DONE" | "FAILED";
  phase: string;
  cursor: unknown;
  counts: Row;
  issues: unknown[];
  startedById: string;
  startedAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
};

const db = { runs: [] as RunRow[], team: [] as { id: string; isAdmin: boolean; createdAt: Date }[] };

function matchesRun(run: RunRow, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => (run as unknown as Row)[key] === value);
}
const byNewest = (a: RunRow, b: RunRow) => b.startedAt.getTime() - a.startedAt.getTime();

const runDelegate = {
  findFirst: vi.fn(
    async (args: { where?: Row; orderBy?: Row } = {}) =>
      [...db.runs].sort(byNewest).find((run) => matchesRun(run, args.where)) ?? null,
  ),
  findUnique: vi.fn(async (args: { where: { id: string } }) => db.runs.find((run) => run.id === args.where.id) ?? null),
  update: vi.fn(),
};

const teamDelegate = {
  findFirst: vi.fn(async (args: { where?: Row; orderBy?: Row } = {}) => {
    const matches = db.team.filter((m) => {
      if (args.where?.isAdmin !== undefined && m.isAdmin !== args.where.isAdmin) return false;
      return true;
    });
    matches.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return matches[0] ?? null;
  }),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesImportRun: runDelegate,
    teamMember: teamDelegate,
  },
}));

const startImportRun = vi.fn();
const continueImportRun = vi.fn();
vi.mock("@/lib/sales/pipedrive/import", () => ({
  startImportRun: (...args: unknown[]) => startImportRun(...args),
  continueImportRun: (...args: unknown[]) => continueImportRun(...args),
}));

const route = await import("@/app/api/cron/sales-pipedrive-sync/route");
const { PipedriveError } = await import("@/lib/sales/pipedrive/client");

const CRON_SECRET = "cron-secret-12345-abcdef";
const FAKE_TOKEN = "pdtok-SECRETVALUE-0123456789abcdefZQ9x";

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost/api/cron/sales-pipedrive-sync", { headers });
}

beforeEach(() => {
  db.runs = [];
  db.team = [{ id: "admin-1", isAdmin: true, createdAt: new Date(Date.UTC(2026, 0, 1)) }];
  runDelegate.update.mockReset();
  startImportRun.mockReset().mockResolvedValue({ ok: true, runId: "new-run" });
  continueImportRun.mockReset().mockResolvedValue({ done: true, paused: false, phase: "done", counts: {} });
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("SALES_PIPEDRIVE_SYNC_ENABLED", "true");
  vi.stubEnv("PIPEDRIVE_API_TOKEN", FAKE_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/sales-pipedrive-sync", () => {
  it("answers 401 without the bearer secret", async () => {
    const res = await route.GET(req());
    expect(res.status).toBe(401);
    expect(startImportRun).not.toHaveBeenCalled();
  });

  it("answers 401 for a wrong secret", async () => {
    const res = await route.GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("skips when SALES_PIPEDRIVE_SYNC_ENABLED is not 'true'", async () => {
    vi.stubEnv("SALES_PIPEDRIVE_SYNC_ENABLED", "false");
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: expect.stringContaining("turned off") });
    expect(startImportRun).not.toHaveBeenCalled();
  });

  it("skips when SALES_PIPEDRIVE_SYNC_ENABLED is missing", async () => {
    vi.stubEnv("SALES_PIPEDRIVE_SYNC_ENABLED", undefined);
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: expect.stringContaining("turned off") });
  });

  it("skips when PIPEDRIVE_API_TOKEN is not set", async () => {
    vi.stubEnv("PIPEDRIVE_API_TOKEN", undefined);
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: expect.stringContaining("token") });
    expect(startImportRun).not.toHaveBeenCalled();
  });

  it("skips when copying is locked (a final LIVE copy finished)", async () => {
    db.runs.push({
      id: "locked-run",
      mode: "LIVE",
      isFinal: true,
      status: "DONE",
      phase: "done",
      cursor: {},
      counts: {},
      issues: [],
      startedById: "admin-1",
      startedAt: new Date(Date.UTC(2026, 10, 1)),
      updatedAt: new Date(Date.UTC(2026, 10, 1)),
      finishedAt: new Date(Date.UTC(2026, 10, 1)),
    });
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: expect.stringContaining("locked") });
    expect(startImportRun).not.toHaveBeenCalled();
  });

  it("skips when there is no admin to attribute the sync to", async () => {
    db.team = [];
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: expect.stringContaining("admin") });
    expect(startImportRun).not.toHaveBeenCalled();
  });

  it("starts a new LIVE non-final run and drives it when no run is going", async () => {
    continueImportRun.mockResolvedValueOnce({ done: true, paused: false, phase: "done", counts: { "deals.created": 3 } });
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; runId: string; done: boolean; paused: boolean };
    expect(body).toMatchObject({ ok: true, runId: "new-run", done: true, paused: false });
    expect(startImportRun).toHaveBeenCalledWith({ mode: "LIVE", isFinal: false, startedById: "admin-1" });
    expect(continueImportRun).toHaveBeenCalled();
  });

  it("resumes the RUNNING run instead of starting a new one", async () => {
    db.runs.push({
      id: "already-going",
      mode: "LIVE",
      isFinal: false,
      status: "RUNNING",
      phase: "deals",
      cursor: {},
      counts: {},
      issues: [],
      startedById: "admin-1",
      startedAt: new Date(Date.UTC(2026, 10, 10)),
      updatedAt: new Date(),
      finishedAt: null,
    });
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; runId: string };
    expect(body.runId).toBe("already-going");
    expect(startImportRun).not.toHaveBeenCalled();
    expect(continueImportRun).toHaveBeenCalledWith(expect.objectContaining({ runId: "already-going" }));
  });

  it("answers skipped (not ok) when startImportRun refuses the start", async () => {
    startImportRun.mockResolvedValueOnce({ ok: false, message: "An import is already running. Wait for it to finish, or press Keep going." });
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skipped: string };
    expect(body.skipped).toContain("already running");
    expect(continueImportRun).not.toHaveBeenCalled();
  });

  it("drives continue in a loop until the engine says done", async () => {
    continueImportRun
      .mockResolvedValueOnce({ done: false, paused: false, phase: "deals", counts: { "deals.seen": 100 } })
      .mockResolvedValueOnce({ done: false, paused: false, phase: "leads", counts: { "deals.seen": 100, "leads.seen": 50 } })
      .mockResolvedValueOnce({ done: true, paused: false, phase: "done", counts: { "deals.seen": 100, "leads.seen": 50 } });
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; done: boolean; phase: string };
    expect(body).toMatchObject({ ok: true, done: true, phase: "done" });
    expect(continueImportRun).toHaveBeenCalledTimes(3);
  });

  it("stops the loop and answers paused when Pipedrive asks us to slow down", async () => {
    continueImportRun
      .mockResolvedValueOnce({ done: false, paused: false, phase: "deals", counts: {} })
      .mockResolvedValueOnce({ done: false, paused: true, phase: "deals", counts: {} });
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; paused: boolean; done: boolean };
    expect(body).toMatchObject({ ok: true, paused: true, done: false });
    expect(continueImportRun).toHaveBeenCalledTimes(2);
  });

  it("answers 500 when the engine throws an unexpected error", async () => {
    continueImportRun.mockRejectedValueOnce(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: false };
    expect(body.ok).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("builds each client with a deadline inside the function's time budget", async () => {
    // The sync shares the engine's deadline design, so one slow Pipedrive call pauses the run instead of the function timing out.
    let seenDeadline: Date | undefined;
    continueImportRun.mockImplementationOnce(async (args: { deadline?: Date }) => {
      seenDeadline = args.deadline;
      return { done: true, paused: false, phase: "done", counts: {} };
    });
    const res = await route.GET(req(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(seenDeadline).toBeInstanceOf(Date);
    // The chunk deadline is in the future but not too far out.
    const ms = (seenDeadline as Date).getTime() - Date.now();
    expect(ms).toBeGreaterThan(5_000);
    expect(ms).toBeLessThanOrEqual(60_000);
  });
});

// Keeps PipedriveError in the test file so a future reviewer sees it is the error type the loop pauses on.
void PipedriveError;
