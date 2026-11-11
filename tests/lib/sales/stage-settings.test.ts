import { beforeEach, describe, expect, it, vi } from "vitest";

// Per-stage rotting days in Sales settings: the list the settings page reads,
// and the admin route that saves the numbers. Run with a fake database and a
// fake admin check; nothing here reaches a real database or a real session.

const requireAdminMock = vi.fn();
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, requireAdmin: () => requireAdminMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Stage = {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
  rottingDays: number | null;
  archivedAt: Date | null;
};
type Pipeline = { id: string; key: string; name: string; kind: "SALES" | "CONSULTING" | "DELIVERY"; position: number; archivedAt: Date | null };

const stage = (id: string, pipelineId: string, position: number, extra: Partial<Stage> = {}): Stage => ({
  id,
  pipelineId,
  name: `Stage ${id}`,
  position,
  probability: 20,
  isWon: false,
  isLost: false,
  rottingDays: 14,
  archivedAt: null,
  ...extra,
});

const db = { pipelines: [] as Pipeline[], stages: [] as Stage[], audits: [] as Row[] };

function seed() {
  db.pipelines = [
    { id: "pm1", key: "sales", name: "Sales", kind: "SALES", position: 0, archivedAt: null },
    { id: "pm2", key: "consulting", name: "Consulting", kind: "CONSULTING", position: 1, archivedAt: null },
    { id: "pd", key: "delivery", name: "Delivery", kind: "DELIVERY", position: 2, archivedAt: null },
  ];
  db.stages = [
    stage("s4", "pm1", 0, { name: "Discovery", probability: 20 }),
    stage("s5", "pm1", 1, { name: "Proposal Sent", probability: 60 }),
    stage("s7", "pm1", 2, { name: "Won", probability: 100, isWon: true, rottingDays: null }),
    stage("s8", "pm1", 3, { name: "Lost", probability: 0, isLost: true, rottingDays: null }),
    stage("s9", "pm2", 0, { name: "Intro Call" }),
    stage("d1", "pd", 0, { name: "Kickoff" }),
  ];
  db.audits = [];
}

type StagesSelect = { select: Row; where: Row; orderBy: Row };
const pick = (row: Row, select: Row) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
const liveStagesOf = (pipelineId: string) =>
  db.stages.filter((s) => s.pipelineId === pipelineId && s.archivedAt === null).sort((a, b) => a.position - b.position);

const pipelineFindFirst = vi.fn(async (args: { where: { id: string; archivedAt: null; kind: { in: string[] } }; select: Row & { stages: StagesSelect } }) => {
  const found = db.pipelines.find(
    (p) => p.id === args.where.id && p.archivedAt === null && args.where.archivedAt === null && args.where.kind.in.includes(p.kind),
  );
  if (!found) return null;
  const { stages, ...rest } = args.select;
  expect(stages.where).toEqual({ archivedAt: null });
  return { ...pick(found, rest), stages: liveStagesOf(found.id).map((s) => pick(s, stages.select)) };
});
const pipelineFindMany = vi.fn();
const stageUpdate = vi.fn(async (args: { where: { id: string }; data: { rottingDays: number | null } }) => {
  const row = db.stages.find((s) => s.id === args.where.id)!;
  row.rottingDays = args.data.rottingDays;
  return row;
});

const tx = {
  salesPipeline: { findFirst: pipelineFindFirst, findMany: pipelineFindMany },
  salesStage: { update: stageUpdate },
  salesAuditLog: { create: async (args: { data: Row }) => db.audits.push(args.data) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
}));

const { loadStageSettings } = await import("@/lib/sales/settings");
const route = await import("@/app/api/sales/pipelines/[pipelineId]/stages/route");
const { PermissionError } = await import("@/lib/permissions");

const ROTTING_ERROR = "Use a number from 1 to 365, or leave it blank.";

function patch(pipelineId: string, body: unknown, headers: Record<string, string> = {}) {
  return route.PATCH(
    new Request(`http://localhost/api/sales/pipelines/${pipelineId}/stages`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    }),
    { params: Promise.resolve({ pipelineId }) },
  );
}

function expectNothingWritten() {
  expect(stageUpdate).not.toHaveBeenCalled();
  expect(db.audits).toEqual([]);
}

beforeEach(() => {
  seed();
  pipelineFindFirst.mockClear();
  pipelineFindMany.mockReset();
  stageUpdate.mockClear();
  requireAdminMock.mockReset().mockResolvedValue({ userId: "admin1", isAdmin: true });
});

describe("loadStageSettings", () => {
  it("lists Sales and Consulting pipelines with their stages", async () => {
    pipelineFindMany.mockResolvedValue([
      {
        id: "pm1",
        key: "sales",
        name: "Sales",
        kind: "SALES",
        stages: [
          { id: "s4", name: "Discovery", probability: 20, isWon: false, isLost: false, rottingDays: 14 },
          { id: "s7", name: "Won", probability: 100, isWon: true, isLost: false, rottingDays: null },
        ],
      },
      {
        id: "pm2",
        key: "consulting",
        name: "Consulting",
        kind: "CONSULTING",
        stages: [{ id: "s9", name: "Intro Call", probability: 20, isWon: false, isLost: false, rottingDays: 21 }],
      },
    ]);

    const result = await loadStageSettings();

    expect(pipelineFindMany).toHaveBeenCalledTimes(1);
    expect(pipelineFindMany.mock.calls[0][0]).toEqual({
      where: { archivedAt: null, kind: { in: ["SALES", "CONSULTING"] } },
      orderBy: { position: "asc" },
      select: {
        id: true,
        key: true,
        name: true,
        kind: true,
        stages: {
          where: { archivedAt: null },
          orderBy: { position: "asc" },
          select: { id: true, name: true, probability: true, isWon: true, isLost: true, rottingDays: true },
        },
      },
    });
    expect(result).toEqual([
      {
        id: "pm1",
        key: "sales",
        name: "Sales",
        kind: "SALES",
        stages: [
          { id: "s4", name: "Discovery", probability: 20, isWon: false, isLost: false, rottingDays: 14 },
          { id: "s7", name: "Won", probability: 100, isWon: true, isLost: false, rottingDays: null },
        ],
      },
      {
        id: "pm2",
        key: "consulting",
        name: "Consulting",
        kind: "CONSULTING",
        stages: [{ id: "s9", name: "Intro Call", probability: 20, isWon: false, isLost: false, rottingDays: 21 }],
      },
    ]);
  });
});

describe("PATCH /api/sales/pipelines/[pipelineId]/stages", () => {
  it("admins only", async () => {
    requireAdminMock.mockRejectedValue(new PermissionError(403, "This action is for admins only."));

    const res = await patch("pm1", { stages: [{ id: "s4", rottingDays: 21 }] });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This action is for admins only." });
    expect(pipelineFindFirst).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("saves only what changed, one history row per stage", async () => {
    const res = await patch(
      "pm1",
      {
        stages: [
          { id: "s4", rottingDays: 21 },
          { id: "s5", rottingDays: 14 },
          { id: "s7", rottingDays: null },
        ],
      },
      { "x-real-ip": "198.51.100.7", "user-agent": "Admin browser" },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stages: [
        { id: "s4", rottingDays: 21 },
        { id: "s5", rottingDays: 14 },
        { id: "s7", rottingDays: null },
      ],
    });
    expect(stageUpdate.mock.calls).toEqual([[{ where: { id: "s4" }, data: { rottingDays: 21 } }]]);
    expect(db.audits).toEqual([
      {
        actorType: "USER",
        actorId: "admin1",
        botTokenId: null,
        entityType: "SalesStage",
        entityId: "s4",
        action: "updated",
        before: { rottingDays: 14 },
        after: { rottingDays: 21 },
        ipAddress: "198.51.100.7",
        userAgent: "Admin browser",
      },
    ]);
  });

  it("reads the pipeline and its live stages from Sales and Consulting only", async () => {
    await patch("pm1", { stages: [{ id: "s4", rottingDays: 30 }] });

    expect(pipelineFindFirst).toHaveBeenCalledWith({
      where: { id: "pm1", archivedAt: null, kind: { in: ["SALES", "CONSULTING"] } },
      select: {
        id: true,
        stages: { where: { archivedAt: null }, select: { id: true, isWon: true, isLost: true, rottingDays: true } },
      },
    });
  });

  it("writes one row for each stage that changed, and clears a number with blank", async () => {
    const res = await patch("pm1", {
      stages: [
        { id: "s5", rottingDays: null },
        { id: "s4", rottingDays: 7 },
      ],
    });

    expect(res.status).toBe(200);
    expect(stageUpdate.mock.calls).toEqual([
      [{ where: { id: "s5" }, data: { rottingDays: null } }],
      [{ where: { id: "s4" }, data: { rottingDays: 7 } }],
    ]);
    expect(db.audits.map((row) => [row.entityId, row.before, row.after])).toEqual([
      ["s5", { rottingDays: 14 }, { rottingDays: null }],
      ["s4", { rottingDays: 14 }, { rottingDays: 7 }],
    ]);
  });

  it("writes nothing when no number changed", async () => {
    const res = await patch("pm1", { stages: [{ id: "s4", rottingDays: 14 }, { id: "s8", rottingDays: null }] });

    expect(res.status).toBe(200);
    expectNothingWritten();
  });

  it("keeps the numbers sensible", async () => {
    for (const rottingDays of [0, 366, 2.5, "7"]) {
      const res = await patch("pm1", { stages: [{ id: "s4", rottingDays }] });
      expect(res.status, String(rottingDays)).toBe(400);
      expect(await res.json(), String(rottingDays)).toEqual({ error: ROTTING_ERROR });
    }
    expect(pipelineFindFirst).not.toHaveBeenCalled();

    const won = await patch("pm1", { stages: [{ id: "s4", rottingDays: 21 }, { id: "s7", rottingDays: 30 }] });
    expect(won.status).toBe(400);
    expect(await won.json()).toEqual({ error: "Won and lost stages never go stale." });

    const lost = await patch("pm1", { stages: [{ id: "s8", rottingDays: 30 }] });
    expect(await lost.json()).toEqual({ error: "Won and lost stages never go stale." });

    const otherPipeline = await patch("pm1", { stages: [{ id: "s4", rottingDays: 21 }, { id: "s9", rottingDays: 21 }] });
    expect(otherPipeline.status).toBe(400);
    expect(await otherPipeline.json()).toEqual({ error: "That stage is not part of this pipeline." });

    for (const pipelineId of ["pd", "nope"]) {
      const res = await patch(pipelineId, { stages: [{ id: "d1", rottingDays: 21 }] });
      expect(res.status, pipelineId).toBe(404);
      expect(await res.json(), pipelineId).toEqual({ error: "Pipeline not found." });
    }

    const blocked = await patch("pm1", { stages: [{ id: "s4", rottingDays: 21 }] }, { host: "localhost", origin: "https://evil.example" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "Request blocked." });

    expectNothingWritten();
    expect(db.stages.find((s) => s.id === "s4")?.rottingDays).toBe(14);
  });

  it("refuses an archived stage or pipeline the same way as a missing one", async () => {
    db.stages.find((s) => s.id === "s5")!.archivedAt = new Date("2026-11-01T12:00:00.000Z");
    const archivedStage = await patch("pm1", { stages: [{ id: "s5", rottingDays: 21 }] });
    expect(await archivedStage.json()).toEqual({ error: "That stage is not part of this pipeline." });

    db.pipelines.find((p) => p.id === "pm2")!.archivedAt = new Date("2026-11-01T12:00:00.000Z");
    const archivedPipeline = await patch("pm2", { stages: [{ id: "s9", rottingDays: 21 }] });
    expect(archivedPipeline.status).toBe(404);

    expectNothingWritten();
  });

  it("rejects bodies it cannot read", async () => {
    const cases: unknown[] = [
      {},
      { stages: [] },
      { stages: [{ id: "s4", rottingDays: 21 }], extra: true },
      { stages: [{ id: "s4", rottingDays: 21, name: "Renamed" }] },
      { stages: [{ id: "", rottingDays: 21 }] },
      { stages: [{ id: "s4", rottingDays: 21 }, { id: "s4", rottingDays: 30 }] },
      { stages: Array.from({ length: 51 }, (_, index) => ({ id: `s${index}`, rottingDays: 10 })) },
      null,
    ];
    for (const body of cases) {
      const res = await patch("pm1", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json(), JSON.stringify(body)).toEqual({ error: "Invalid input." });
    }
    expect(pipelineFindFirst).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("refuses a pipeline id longer than any real one without reading", async () => {
    const res = await patch("p".repeat(65), { stages: [{ id: "s4", rottingDays: 21 }] });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Pipeline not found." });
    expect(pipelineFindFirst).not.toHaveBeenCalled();
  });
});
