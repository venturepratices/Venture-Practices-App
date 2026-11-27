import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The nightly database backup cron. It is the safety net behind everything
// else, so a backup that did not happen must never look fine: a thrown error
// and a "nothing was written" answer both reach Sentry and answer 500.
//
// Nothing here reaches a real database or Blob store. Sentry is mocked at the
// SDK edge so the real reportCronFailure runs and the test proves the route is
// wired through to Sentry, not just that some mock was called.

const createDatabaseSnapshot = vi.hoisted(() => vi.fn());
const writeBackupToBlob = vi.hoisted(() => vi.fn());
const pruneOldBackups = vi.hoisted(() => vi.fn());
vi.mock("@/lib/backup", () => ({
  backupDateKey: () => "2026-11-27",
  createDatabaseSnapshot: (...args: unknown[]) => createDatabaseSnapshot(...args),
  writeBackupToBlob: (...args: unknown[]) => writeBackupToBlob(...args),
  pruneOldBackups: (...args: unknown[]) => pruneOldBackups(...args),
}));

const captureException = vi.hoisted(() => vi.fn());
const flush = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  flush: (...args: unknown[]) => flush(...args),
}));

const route = await import("@/app/api/cron/backup/route");

const SECRET = "test-cron-secret-value";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/backup", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/cron/backup", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
    flush.mockResolvedValue(true);
    createDatabaseSnapshot.mockResolvedValue({ counts: { clients: 4, tasks: 120 } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    createDatabaseSnapshot.mockReset();
    writeBackupToBlob.mockReset();
    pruneOldBackups.mockReset();
    captureException.mockReset();
    flush.mockReset();
  });

  it("refuses a request with no secret, and backs up nothing", async () => {
    const res = await route.GET(request());
    expect(res.status).toBe(401);
    expect(createDatabaseSnapshot).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("a good backup answers ok, prunes old ones, and tells Sentry nothing", async () => {
    writeBackupToBlob.mockResolvedValue({ written: true, pathname: "backups/2026-11-27.json" });
    pruneOldBackups.mockResolvedValue(2);

    const res = await route.GET(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      written: true,
      pathname: "backups/2026-11-27.json",
      pruned: 2,
      counts: { clients: 4, tasks: 120 },
    });
    expect(pruneOldBackups).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("an error thrown while backing up is reported to Sentry and answers 500", async () => {
    const failure = new Error("database unreachable");
    createDatabaseSnapshot.mockRejectedValue(failure);

    const res = await route.GET(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Backup failed" });
    expect(captureException).toHaveBeenCalledWith(failure, { tags: { cron: "backup" }, level: "error" });
    expect(flush).toHaveBeenCalledWith(2000);
    expect(writeBackupToBlob).not.toHaveBeenCalled();
  });

  it("a backup that was not written is reported to Sentry, answers 500, and does not prune", async () => {
    writeBackupToBlob.mockResolvedValue({ written: false, pathname: "backups/2026-11-27.json" });

    const res = await route.GET(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Backup not written" });
    expect(captureException).toHaveBeenCalledTimes(1);
    const [reported, options] = captureException.mock.calls[0];
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe("Backup was not written (storage credentials missing?)");
    expect(options).toEqual({ tags: { cron: "backup" }, level: "error" });
    expect(pruneOldBackups).not.toHaveBeenCalled();
  });

  it("still answers 500 if Sentry itself is down", async () => {
    createDatabaseSnapshot.mockRejectedValue(new Error("database unreachable"));
    captureException.mockImplementation(() => {
      throw new Error("sentry is down");
    });

    const res = await route.GET(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Backup failed" });
  });
});
