import { describe, expect, it, vi } from "vitest";

// ensureSalesSeed takes the database as an argument, so no real database is used.
// The default `prisma` import is mocked only so loading the module stays inert.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { SALES_SEED_PIPELINES, SALES_SEED_FIELDS } = await import("@/lib/sales/seed-data");
const { ensureSalesSeed } = await import("@/lib/sales/seed");

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the three Sales config tables. */
function fakeDb() {
  const pipelines: Row[] = [];
  const stages: Row[] = [];
  const fields: Row[] = [];
  const upserts = { pipelines: [] as Row[], stages: [] as Row[], fields: [] as Row[] };

  const db = {
    salesPipeline: {
      findMany: async () => pipelines.map((p) => ({ ...p })),
      upsert: async (args: { where: Row; create: Row; update: Row }) => {
        upserts.pipelines.push(args as unknown as Row);
        let row = pipelines.find((p) => p.key === args.where.key);
        if (!row) {
          row = { id: `p${pipelines.length + 1}`, ...args.create };
          pipelines.push(row);
        }
        return { ...row };
      },
    },
    salesStage: {
      findMany: async (args: { where: { pipelineId: string } }) =>
        stages.filter((s) => s.pipelineId === args.where.pipelineId).map((s) => ({ ...s })),
      upsert: async (args: {
        where: { pipelineId_key: { pipelineId: string; key: string } };
        create: Row;
        update: Row;
      }) => {
        upserts.stages.push(args as unknown as Row);
        const { pipelineId, key } = args.where.pipelineId_key;
        let row = stages.find((s) => s.pipelineId === pipelineId && s.key === key);
        if (!row) {
          row = { id: `s${stages.length + 1}`, ...args.create };
          stages.push(row);
        }
        return { ...row };
      },
    },
    salesCustomField: {
      findMany: async () => fields.map((f) => ({ ...f })),
      upsert: async (args: { where: { key: string }; create: Row; update: Row }) => {
        upserts.fields.push(args as unknown as Row);
        let row = fields.find((f) => f.key === args.where.key);
        if (!row) {
          row = { id: `f${fields.length + 1}`, ...args.create };
          fields.push(row);
        }
        return { ...row };
      },
    },
  };
  return { db, pipelines, stages, fields, upserts };
}

describe("seed data", () => {
  const byKey = (key: string) => SALES_SEED_PIPELINES.find((p) => p.key === key)!;

  it("has the five spec pipelines with the right kinds", () => {
    expect(SALES_SEED_PIPELINES.map((p) => [p.key, p.kind])).toEqual([
      ["direct-mail", "SALES"],
      ["new-mover-mail", "SALES"],
      ["marketing-agency", "CONSULTING"],
      ["client-delivery", "DELIVERY"],
      ["consulting-delivery", "DELIVERY"],
    ]);
    expect(SALES_SEED_PIPELINES.reduce((n, p) => n + p.stages.length, 0)).toBe(33);
    expect(SALES_SEED_FIELDS).toHaveLength(11);
  });

  it("gives Direct Mail 8 stages in order with the spec probabilities", () => {
    const stages = byKey("direct-mail").stages;
    expect(stages).toHaveLength(8);
    expect(stages.map((s) => s.probability)).toEqual([10, 20, 20, 30, 70, 85, 100, 100]);
    expect(stages.map((s) => s.name)).toEqual([
      "New Opt-In",
      "Appointment Scheduled",
      "No Show",
      "Demo Complete",
      "Proposal Sent",
      "Follow-Up",
      "Contract Signed",
      "Sent to Onboarding",
    ]);
    expect(stages.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("has exactly one requiresValue stage per sales and consulting pipeline", () => {
    for (const key of ["direct-mail", "new-mover-mail", "marketing-agency"]) {
      const flagged = byKey(key).stages.filter((s) => s.requiresValue);
      expect(flagged.map((s) => s.name)).toEqual(["Proposal Sent"]);
    }
    for (const key of ["client-delivery", "consulting-delivery"]) {
      expect(byKey(key).stages.some((s) => s.requiresValue)).toBe(false);
    }
  });

  it("flags no-show, won and lost stages as the spec says", () => {
    const flagged = (flag: "isNoShow" | "isWon" | "isLost") =>
      SALES_SEED_PIPELINES.flatMap((p) => p.stages.filter((s) => s[flag]).map((s) => `${p.key}:${s.name}`));
    expect(flagged("isNoShow")).toEqual(["direct-mail:No Show", "new-mover-mail:No Show/Cancel"]);
    expect(flagged("isLost")).toEqual(["marketing-agency:Deal Lost Nurture"]);
    expect(flagged("isWon")).toEqual([
      "direct-mail:Contract Signed",
      "direct-mail:Sent to Onboarding",
      "new-mover-mail:Deal Won",
      "marketing-agency:Deal Won",
      "client-delivery:Reporting",
      "consulting-delivery:Renewal or Completion",
    ]);
  });

  it("uses kebab-case stage keys that are unique within a pipeline", () => {
    for (const p of SALES_SEED_PIPELINES) {
      const keys = p.stages.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    const newMoverKeys = byKey("new-mover-mail").stages.map((s) => s.key);
    expect(newMoverKeys).toContain("new-lead-check-availability");
    expect(newMoverKeys).toContain("no-show-cancel");
    expect(newMoverKeys).toContain("90-day-trial-get-started");
  });

  it("contains no em dash or en dash in any seed text", () => {
    const text = JSON.stringify([SALES_SEED_PIPELINES, SALES_SEED_FIELDS]);
    expect(text).not.toContain("—");
    expect(text).not.toContain("–");
  });

  it("defines the custom fields from spec section 6", () => {
    const f = (key: string) => SALES_SEED_FIELDS.find((x) => x.key === key)!;
    expect(f("target-start-date")).toMatchObject({ entity: "DEAL", fieldType: "DATE", pipelineKeys: [] });
    expect(f("how-would-you-like-to-start")).toMatchObject({
      label: "How would you like to start?",
      fieldType: "SELECT",
      options: ["90-day trial", "Full program", "Not sure yet"],
      pipelineKeys: [],
    });
    for (const key of ["territory-hold-expiry", "mailing-count", "mailing-number"]) {
      expect(f(key).pipelineKeys).toEqual(["direct-mail", "new-mover-mail"]);
    }
    expect(f("mailing-count").fieldType).toBe("NUMBER");
    expect(f("mailing-number").fieldType).toBe("NUMBER");
    expect(f("territory-hold-expiry").fieldType).toBe("DATE");
    for (const key of ["engagement-type", "term", "fee-structure"]) {
      expect(f(key).pipelineKeys).toEqual(["marketing-agency"]);
    }
    expect(f("term").fieldType).toBe("NUMBER");
    expect(f("engagement-type").options).toEqual(["Growth strategy", "Start-up", "Marketing systems"]);
    expect(f("fee-structure").options).toEqual(["Monthly retainer", "Project fee", "Both"]);
    const leadFields = SALES_SEED_FIELDS.filter((x) => x.entity === "LEAD").map((x) => [x.label, x.fieldType]);
    expect(leadFields).toEqual([
      ["Form Source", "SELECT"],
      ["Practice ZIP", "TEXT"],
      ["Practice Name", "TEXT"],
    ]);
    expect(f("form-source").options).toEqual(["Check Availability", "Direct inquiry", "Referral"]);
    const positions = SALES_SEED_FIELDS.map((x) => x.position);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe("ensureSalesSeed", () => {
  it("creates everything on a fresh database, upserting by key and [pipelineId, key]", async () => {
    const { db, upserts, pipelines, stages, fields } = fakeDb();
    const result = await ensureSalesSeed(db as never);
    expect(result).toEqual({ pipelines: 5, stages: 33, fields: 11 });
    expect(pipelines).toHaveLength(5);
    expect(stages).toHaveLength(33);
    expect(fields).toHaveLength(11);

    expect(upserts.pipelines[0]).toMatchObject({ where: { key: "direct-mail" } });
    expect(upserts.stages[0]).toMatchObject({
      where: { pipelineId_key: { pipelineId: "p1", key: "new-opt-in" } },
    });
    expect(upserts.fields[0]).toMatchObject({ where: { key: "target-start-date" } });

    // Stages land in the right pipeline.
    const directMailId = pipelines.find((p) => p.key === "direct-mail")!.id;
    expect(stages.filter((s) => s.pipelineId === directMailId)).toHaveLength(8);
  });

  it("reports zero created on a second run and never overwrites existing rows", async () => {
    const { db, upserts } = fakeDb();
    await ensureSalesSeed(db as never);
    upserts.pipelines.length = 0;
    upserts.stages.length = 0;
    upserts.fields.length = 0;

    const second = await ensureSalesSeed(db as never);
    expect(second).toEqual({ pipelines: 0, stages: 0, fields: 0 });
    for (const call of [...upserts.pipelines, ...upserts.stages, ...upserts.fields]) {
      expect((call as { update: Row }).update).toEqual({});
    }
  });

  it("only creates what is missing, leaving admin edits alone", async () => {
    const { db, pipelines, stages, fields } = fakeDb();
    await ensureSalesSeed(db as never);
    // An admin renamed a pipeline, and one stage and one field went missing.
    pipelines.find((p) => p.key === "direct-mail")!.name = "Renamed by admin";
    stages.splice(
      stages.findIndex((s) => s.key === "follow-up"),
      1,
    );
    fields.splice(0, 1);

    const result = await ensureSalesSeed(db as never);
    expect(result).toEqual({ pipelines: 0, stages: 1, fields: 1 });
    expect(pipelines.find((p) => p.key === "direct-mail")!.name).toBe("Renamed by admin");
  });

  it("leaves archived pipelines and stages archived instead of making new ones", async () => {
    const { db, pipelines, stages } = fakeDb();
    await ensureSalesSeed(db as never);
    const archivedAt = new Date("2026-11-01T00:00:00.000Z");
    const pipeline = pipelines.find((p) => p.key === "new-mover-mail")!;
    pipeline.archivedAt = archivedAt;
    const stage = stages.find((s) => s.pipelineId === pipeline.id && s.key === "no-show-cancel")!;
    stage.archivedAt = archivedAt;

    const result = await ensureSalesSeed(db as never);

    expect(result).toEqual({ pipelines: 0, stages: 0, fields: 0 });
    expect(pipelines).toHaveLength(5);
    expect(stages).toHaveLength(33);
    expect(pipelines.filter((p) => p.key === "new-mover-mail")).toEqual([pipeline]);
    expect(pipeline.archivedAt).toBe(archivedAt);
    expect(stages.filter((s) => s.pipelineId === pipeline.id && s.key === "no-show-cancel")).toEqual([stage]);
    expect(stage.archivedAt).toBe(archivedAt);
  });
});
