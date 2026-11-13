import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The admin routes behind "Copy from Pipedrive", run directly with a fake
// database, a fake admin check, and the engine and check report faked. Nothing
// here reaches a real database, a real session or Pipedrive.

const requireAdminMock = vi.fn();
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, requireAdmin: () => requireAdminMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

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

const db = { runs: [] as RunRow[], salesMemberIds: new Set<string>(), team: [] as { id: string; name: string; email: string }[] };

function matchesRun(run: RunRow, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => (run as unknown as Row)[key] === value);
}
const byNewest = (a: RunRow, b: RunRow) => b.startedAt.getTime() - a.startedAt.getTime();

const runDelegate = {
  findFirst: vi.fn(async (args: { where?: Row } = {}) => [...db.runs].sort(byNewest).find((run) => matchesRun(run, args.where)) ?? null),
  findUnique: vi.fn(async (args: { where: { id: string } }) => db.runs.find((run) => run.id === args.where.id) ?? null),
  update: vi.fn(async (args: { where: { id: string }; data: Row }) => {
    const run = db.runs.find((r) => r.id === args.where.id);
    if (!run) throw Object.assign(new Error("No record was found for an update."), { code: "P2025" });
    Object.assign(run, args.data);
    return run;
  }),
};

function memberMatches(id: string, where: Row): boolean {
  if (typeof where.id === "string" && where.id !== id) return false;
  if (where.OR !== undefined) {
    expect({ OR: where.OR }).toEqual({ OR: [{ isAdmin: true }, { canUseSales: true }] });
    if (!db.salesMemberIds.has(id)) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesImportRun: runDelegate,
    teamMember: {
      findFirst: async (args: { where: Row }) => db.team.find((m) => memberMatches(m.id, args.where)) ?? null,
      findMany: async (args: { where: Row }) =>
        db.team.filter((m) => memberMatches(m.id, args.where)).map((m) => ({ id: m.id, name: m.name })),
    },
  },
}));

const startImportRun = vi.fn();
const continueImportRun = vi.fn();
const setUserMapping = vi.fn();
const loadUserMappings = vi.fn();
vi.mock("@/lib/sales/pipedrive/import", () => ({
  startImportRun: (...args: unknown[]) => startImportRun(...args),
  continueImportRun: (...args: unknown[]) => continueImportRun(...args),
  setUserMapping: (...args: unknown[]) => setUserMapping(...args),
  loadUserMappings: (...args: unknown[]) => loadUserMappings(...args),
}));

/** The options each real Pipedrive client was built with (it is never asked to send anything here). */
const clientOptions: Record<string, unknown>[] = [];
vi.mock("@/lib/sales/pipedrive/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/pipedrive/client")>();
  return {
    ...actual,
    createPipedriveClient: (opts: Parameters<typeof actual.createPipedriveClient>[0]) => {
      clientOptions.push(opts);
      return actual.createPipedriveClient(opts);
    },
  };
});

const buildCheckReport = vi.fn();
vi.mock("@/lib/sales/pipedrive/verify", () => ({
  buildCheckReport: (...args: unknown[]) => buildCheckReport(...args),
}));

const startRoute = await import("@/app/api/sales/import/start/route");
const continueRoute = await import("@/app/api/sales/import/continue/route");
const checkRoute = await import("@/app/api/sales/import/check/route");
const statusRoute = await import("@/app/api/sales/import/status/route");
const usersRoute = await import("@/app/api/sales/import/users/route");
const { PermissionError } = await import("@/lib/permissions");
const { randomIndexes } = await import("@/lib/sales/pipedrive/import-check");
const { PipedriveError } = await import("@/lib/sales/pipedrive/client");

const FAKE_TOKEN = "pdtok-SECRETVALUE-0123456789abcdefZQ9x";
const ADMIN = { userId: "admin-1", isAdmin: true };

const req = (method: string, body?: unknown, path = "start") =>
  new Request(`http://localhost/api/sales/import/${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

function run(overrides: Partial<RunRow> = {}): RunRow {
  const row: RunRow = {
    id: `run${db.runs.length + 1}`,
    mode: "LIVE",
    isFinal: false,
    status: "DONE",
    phase: "done",
    cursor: { context: { users: [] }, source: 0, page: null },
    counts: {},
    issues: [],
    startedById: "admin-1",
    startedAt: new Date(Date.UTC(2026, 10, 12, 15, db.runs.length)),
    updatedAt: new Date(Date.UTC(2026, 10, 12, 16, 0)),
    finishedAt: new Date(Date.UTC(2026, 10, 12, 16, 0)),
    ...overrides,
  };
  db.runs.push(row);
  return row;
}

beforeEach(() => {
  db.runs = [];
  db.team = [
    { id: "m1", name: "Ben Example", email: "ben@example.com" },
    { id: "m2", name: "Robert O.", email: "robert@example.com" },
  ];
  db.salesMemberIds = new Set(["m1"]);
  requireAdminMock.mockReset().mockResolvedValue(ADMIN);
  startImportRun.mockReset().mockResolvedValue({ ok: true, runId: "new-run" });
  continueImportRun.mockReset().mockResolvedValue({ done: false, paused: false, phase: "deals", counts: { "deals.created": 4 } });
  setUserMapping.mockReset().mockResolvedValue(undefined);
  loadUserMappings.mockReset().mockResolvedValue([]);
  buildCheckReport.mockReset().mockResolvedValue({ rows: [], spot: [] });
  vi.stubEnv("PIPEDRIVE_API_TOKEN", FAKE_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const ROUTES: [string, () => Promise<Response>][] = [
  ["start", () => startRoute.POST(req("POST", { mode: "DRY_RUN" }))],
  ["continue", () => continueRoute.POST(req("POST", { runId: "run1" }, "continue"))],
  ["check", () => checkRoute.POST(req("POST", {}, "check"))],
  ["status", () => statusRoute.GET()],
  ["users", () => usersRoute.PUT(req("PUT", { pipedriveUserId: 7, memberId: "m1" }, "users"))],
];

describe("who may call the import routes", () => {
  it.each(ROUTES)("%s answers 403 to a Sales user who is not an admin", async (_name, call) => {
    requireAdminMock.mockRejectedValue(new PermissionError(403, "This action is for admins only."));
    const res = await call();
    expect(res.status).toBe(403);
    expect(startImportRun).not.toHaveBeenCalled();
    expect(continueImportRun).not.toHaveBeenCalled();
    expect(buildCheckReport).not.toHaveBeenCalled();
    expect(setUserMapping).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("%s answers 401 when signed out", async (_name, call) => {
    requireAdminMock.mockRejectedValue(new PermissionError(401, "You need to be signed in."));
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("the long routes allow 60 seconds", () => {
    expect(continueRoute.maxDuration).toBe(60);
    expect(checkRoute.maxDuration).toBe(60);
  });
});

describe("POST start", () => {
  it("starts a practice run and answers its id", async () => {
    const res = await startRoute.POST(req("POST", { mode: "DRY_RUN" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: "new-run" });
    expect(startImportRun).toHaveBeenCalledWith({ mode: "DRY_RUN", isFinal: false, startedById: "admin-1" });
  });

  it("answers 409 with the engine's own words when it refuses", async () => {
    startImportRun.mockResolvedValue({ ok: false, message: "An import is already running. Wait for it to finish, or press Keep going." });
    const res = await startRoute.POST(req("POST", { mode: "LIVE" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "An import is already running. Wait for it to finish, or press Keep going." });
  });

  it("refuses the final copy without the typed word", async () => {
    const res = await startRoute.POST(req("POST", { mode: "FINAL" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/LOCK/);
    const wrong = await startRoute.POST(req("POST", { mode: "FINAL", confirm: "lock" }));
    expect(wrong.status).toBe(400);
    expect(startImportRun).not.toHaveBeenCalled();
  });

  it("starts the final copy as a real copy marked final when LOCK is typed", async () => {
    const res = await startRoute.POST(req("POST", { mode: "FINAL", confirm: "LOCK" }));
    expect(res.status).toBe(200);
    expect(startImportRun).toHaveBeenCalledWith({ mode: "LIVE", isFinal: true, startedById: "admin-1" });
  });

  it("refuses to start without a token", async () => {
    vi.stubEnv("PIPEDRIVE_API_TOKEN", "");
    const res = await startRoute.POST(req("POST", { mode: "DRY_RUN" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "The Pipedrive token is not set yet." });
    expect(startImportRun).not.toHaveBeenCalled();
  });

  it("refuses unknown modes and extra keys", async () => {
    expect((await startRoute.POST(req("POST", { mode: "EVERYTHING" }))).status).toBe(400);
    expect((await startRoute.POST(req("POST", { mode: "LIVE", isFinal: true }))).status).toBe(400);
  });
});

describe("POST continue", () => {
  it("carries a running run forward with a deadline 45 seconds ahead", async () => {
    run({ status: "RUNNING", phase: "deals", finishedAt: null });
    const before = Date.now();
    const res = await continueRoute.POST(req("POST", { runId: "run1" }, "continue"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: false, paused: false, phase: "deals", counts: { "deals.created": 4 } });
    const args = continueImportRun.mock.calls[0][0] as { runId: string; deadline: Date; now: () => Date; client: unknown };
    expect(args.runId).toBe("run1");
    const ahead = args.deadline.getTime() - before;
    expect(ahead).toBeGreaterThanOrEqual(44_000);
    expect(ahead).toBeLessThanOrEqual(46_000);
    expect(args.now()).toBeInstanceOf(Date);
    // The client stops its own retries at the same deadline, so a slow Pipedrive pauses the run instead of timing out.
    expect((clientOptions.at(-1)?.deadline as Date).getTime()).toBe(args.deadline.getTime());
  });

  it("answers 409 for a run that is not running", async () => {
    run({ status: "DONE" });
    const res = await continueRoute.POST(req("POST", { runId: "run1" }, "continue"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not running/i);
    expect(continueImportRun).not.toHaveBeenCalled();
  });

  it("answers 404 for a run that does not exist", async () => {
    const res = await continueRoute.POST(req("POST", { runId: "nope" }, "continue"));
    expect(res.status).toBe(404);
  });

  it("answers 409, not a crash, when the run finishes between the route's look and the engine's", async () => {
    const row = run({ status: "RUNNING", phase: "notes", finishedAt: null });
    continueImportRun.mockImplementation(async () => {
      row.status = "DONE";
      throw new Error("This import is not running, so it cannot continue.");
    });
    const res = await continueRoute.POST(req("POST", { runId: "run1" }, "continue"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This copy is not running any more.");
  });

  it("still fails loudly on an unexpected error while the run is running", async () => {
    run({ status: "RUNNING", phase: "notes", finishedAt: null });
    continueImportRun.mockRejectedValue(new Error("database went away"));
    await expect(continueRoute.POST(req("POST", { runId: "run1" }, "continue"))).rejects.toThrow("database went away");
  });
});

describe("requests from another site and broken bodies", () => {
  const fromElsewhere = (method: string, path: string, body: unknown) =>
    new Request(`http://localhost/api/sales/import/${path}`, {
      method,
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: "https://evil.example", host: "localhost" },
    });

  it.each([
    ["start", () => startRoute.POST(fromElsewhere("POST", "start", { mode: "DRY_RUN" }))],
    ["continue", () => continueRoute.POST(fromElsewhere("POST", "continue", { runId: "run1" }))],
    ["check", () => checkRoute.POST(fromElsewhere("POST", "check", {}))],
    ["users", () => usersRoute.PUT(fromElsewhere("PUT", "users", { pipedriveUserId: 7, memberId: "m1" }))],
  ] as const)("%s refuses a write from another site with 403", async (_name, call) => {
    run({ status: "RUNNING", finishedAt: null });
    const res = await call();
    expect(res.status).toBe(403);
    expect(startImportRun).not.toHaveBeenCalled();
    expect(continueImportRun).not.toHaveBeenCalled();
    expect(buildCheckReport).not.toHaveBeenCalled();
    expect(setUserMapping).not.toHaveBeenCalled();
  });

  const broken = (method: string, path: string) =>
    new Request(`http://localhost/api/sales/import/${path}`, { method, body: "{not json", headers: { "content-type": "application/json" } });

  it.each([
    ["start", () => startRoute.POST(broken("POST", "start"))],
    ["continue", () => continueRoute.POST(broken("POST", "continue"))],
    ["users", () => usersRoute.PUT(broken("PUT", "users"))],
  ] as const)("%s answers 400 to a body that is not JSON", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(400);
  });
});

describe("POST check", () => {
  const CHECK = { rows: [{ label: "Deals", entity: "deals", pipedrive: 3, app: 3, skipped: 0, ok: true }], spot: [] };

  it("checks the finished real copy even when a practice run came after it", async () => {
    buildCheckReport.mockResolvedValue(CHECK);
    run({ mode: "LIVE", status: "DONE", cursor: { source: 0 } });
    run({ mode: "DRY_RUN", status: "DONE", cursor: { source: 0 } });
    const res = await checkRoute.POST(req("POST", {}, "check"));
    expect(res.status).toBe(200);
    expect((db.runs[0].cursor as Row).report).toBeTruthy();
    expect((db.runs[1].cursor as Row).report).toBeUndefined();
  });

  it("refuses when there is only a practice run", async () => {
    run({ mode: "DRY_RUN", status: "DONE" });
    const res = await checkRoute.POST(req("POST", {}, "check"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Run the real copy first." });
    expect(buildCheckReport).not.toHaveBeenCalled();
  });

  it("refuses when the latest real run has not finished", async () => {
    run({ mode: "LIVE", status: "RUNNING", finishedAt: null });
    const res = await checkRoute.POST(req("POST", {}, "check"));
    expect(res.status).toBe(409);
    expect(buildCheckReport).not.toHaveBeenCalled();
  });

  it.each(["RUNNING", "FAILED"] as const)("refuses when a newer real copy is %s, even after a finished one", async (status) => {
    run({ mode: "LIVE", status: "DONE" });
    run({ mode: "LIVE", status, finishedAt: null });
    const res = await checkRoute.POST(req("POST", {}, "check"));
    expect(res.status).toBe(409);
    expect(buildCheckReport).not.toHaveBeenCalled();
  });

  it("answers a Pipedrive failure in plain words without the token, even if the error text carries it", async () => {
    run();
    buildCheckReport.mockRejectedValue(new PipedriveError(500, `Pipedrive answered 500 for api_token=${FAKE_TOKEN}`));
    const res = await checkRoute.POST(req("POST", {}, "check"));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).not.toContain("SECRETVALUE");
    expect(JSON.parse(text).error).toMatch(/^The check could not finish: /);
  });

  it("answers Pipedrive's slow-down with a 409", async () => {
    run();
    buildCheckReport.mockRejectedValue(new PipedriveError(429, "Too many requests."));
    const res = await checkRoute.POST(req("POST", {}, "check"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/slow down/);
  });

  it("gives its client a 50 second deadline, and answers the client's pause with wait a minute", async () => {
    run();
    buildCheckReport.mockRejectedValue(new PipedriveError(429, "Pipedrive is slow right now. The copy will continue in a minute."));
    const before = Date.now();
    const res = await checkRoute.POST(req("POST", {}, "check"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Pipedrive asked us to slow down. Try the check again in a minute.");
    const ahead = (clientOptions.at(-1)?.deadline as Date).getTime() - before;
    expect(ahead).toBeGreaterThanOrEqual(49_000);
    expect(ahead).toBeLessThanOrEqual(51_000);
  });

  it("refuses a second check within a minute of the saved one", async () => {
    run({ cursor: { source: 0, report: { report: CHECK, at: new Date(Date.now() - 30_000).toISOString() } } });
    const res = await checkRoute.POST(req("POST", {}, "check"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/minute/);
    expect(buildCheckReport).not.toHaveBeenCalled();
  });

  it("runs the check with the run's raw skip counts and saves it under cursor.report, keeping the other keys", async () => {
    buildCheckReport.mockResolvedValue(CHECK);
    run({
      cursor: { context: { users: [{ id: 1 }] }, source: 2, page: null, report: { report: CHECK, at: new Date(Date.now() - 120_000).toISOString() } },
      counts: { "deals.skipped": 2, "persons.skipped": 5, "notes.created": 9 },
    });
    const res = await checkRoute.POST(req("POST", {}, "check"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report).toEqual(CHECK);
    expect(typeof body.at).toBe("string");

    const [client, pick, skipped] = buildCheckReport.mock.calls[0] as [unknown, (total: number) => number[], Row];
    expect(client).toBeTruthy();
    expect(typeof pick).toBe("function");
    expect(skipped).toEqual({ organizations: 0, persons: 5, deals: 2, leads: 0, activities: 0, notes: 0 });

    const saved = db.runs[0].cursor as Row;
    expect(saved.context).toEqual({ users: [{ id: 1 }] });
    expect(saved.source).toBe(2);
    expect(saved.page).toBeNull();
    expect(saved.report).toEqual({ report: CHECK, at: body.at });
  });

  it("refuses without a token", async () => {
    run();
    vi.stubEnv("PIPEDRIVE_API_TOKEN", "");
    const res = await checkRoute.POST(req("POST", {}, "check"));
    expect(res.status).toBe(400);
  });
});

describe("randomIndexes", () => {
  it("gives up to 5 distinct positions below the total", () => {
    let n = 0;
    const seq = [0.1, 0.1, 0.5, 0.9, 0.3, 0.7, 0.2];
    const picks = randomIndexes(10, () => seq[n++ % seq.length]);
    expect(picks).toHaveLength(5);
    expect(new Set(picks).size).toBe(5);
    expect(picks.every((at) => Number.isInteger(at) && at >= 0 && at < 10)).toBe(true);
    expect(picks[0]).toBe(1);
  });

  it("gives every position when there are fewer than 5", () => {
    expect([...randomIndexes(3, () => 0)].sort()).toEqual([0, 1, 2]);
    expect(randomIndexes(0, Math.random)).toEqual([]);
  });
});

describe("GET status", () => {
  it("never carries the token beyond its last 4 characters", async () => {
    run({ mode: "DRY_RUN", counts: { "deals.created": 3 }, issues: [{ phase: "deals", message: "x", count: 1, sampleIds: [1] }] });
    loadUserMappings.mockResolvedValue([
      { pipedriveUserId: 7, name: "Old Rep", email: null, memberId: null, memberName: null, auto: false },
    ]);
    const res = await statusRoute.GET();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).not.toContain("SECRETVALUE");
    expect(text).not.toContain(FAKE_TOKEN.slice(0, 8));
    expect(text).not.toContain(FAKE_TOKEN.slice(-5));
    const body = JSON.parse(text);
    expect(body.token).toEqual({ set: true, last4: "ZQ9x" });
    expect(body.run).toMatchObject({ mode: "DRY_RUN", isFinal: false, status: "DONE", phase: "done", counts: { "deals.created": 3 } });
    expect(body.run.issues).toEqual([{ phase: "deals", message: "x", count: 1, sampleIds: [1] }]);
    expect(body.locked).toBe(false);
    expect(body.check).toBeNull();
    expect(body.users).toHaveLength(1);
    expect(body.members).toEqual([{ id: "m1", name: "Ben Example" }]);
    expect(buildCheckReport).not.toHaveBeenCalled();
  });

  it("still hands back the real copy's check after a later practice run", async () => {
    const at = "2026-11-12T16:05:00.000Z";
    run({ mode: "LIVE", cursor: { source: 0, report: { report: { rows: [], spot: [] }, at } } });
    run({ mode: "DRY_RUN", cursor: { source: 0 } });
    const body = await (await statusRoute.GET()).json();
    expect(body.run.mode).toBe("DRY_RUN");
    expect(body.check).toEqual({ report: { rows: [], spot: [] }, at });
    expect(body.realCopy).toEqual({ status: "DONE", finishedAt: "2026-11-12T16:00:00.000Z" });
  });

  it("has no real copy before one has run", async () => {
    run({ mode: "DRY_RUN" });
    const body = await (await statusRoute.GET()).json();
    expect(body.realCopy).toBeNull();
  });

  it("says when copying is locked and hands back the saved check", async () => {
    const at = "2026-11-12T16:05:00.000Z";
    run({ isFinal: true, cursor: { source: 0, report: { report: { rows: [], spot: [] }, at } } });
    const body = await (await statusRoute.GET()).json();
    expect(body.locked).toBe(true);
    expect(body.lockedAt).toBe("2026-11-12T16:00:00.000Z");
    expect(body.check).toEqual({ report: { rows: [], spot: [] }, at });
  });

  it("answers with no run before the first copy", async () => {
    vi.stubEnv("PIPEDRIVE_API_TOKEN", "");
    const body = await (await statusRoute.GET()).json();
    expect(body.run).toBeNull();
    expect(body.token).toEqual({ set: false, last4: null });
  });
});

describe("PUT users", () => {
  it("refuses a member who is not a Sales member", async () => {
    const res = await usersRoute.PUT(req("PUT", { pipedriveUserId: 7, memberId: "m2" }, "users"));
    expect(res.status).toBe(400);
    expect(setUserMapping).not.toHaveBeenCalled();
  });

  it("saves the choice for a Sales member and answers the new list", async () => {
    loadUserMappings.mockResolvedValue([{ pipedriveUserId: 7, name: "Old Rep", email: null, memberId: "m1", memberName: "Ben Example", auto: false }]);
    const res = await usersRoute.PUT(req("PUT", { pipedriveUserId: 7, memberId: "m1" }, "users"));
    expect(res.status).toBe(200);
    expect(setUserMapping).toHaveBeenCalledWith({ pipedriveUserId: 7, memberId: "m1" });
    expect((await res.json()).users).toHaveLength(1);
  });

  it("refuses a Pipedrive user id too big for the database", async () => {
    const res = await usersRoute.PUT(req("PUT", { pipedriveUserId: 2147483648, memberId: "m1" }, "users"));
    expect(res.status).toBe(400);
    expect(setUserMapping).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a number and an id", async () => {
    const res = await usersRoute.PUT(req("PUT", { pipedriveUserId: "7", memberId: "m1" }, "users"));
    expect(res.status).toBe(400);
  });
});
