import { beforeEach, describe, expect, it, vi } from "vitest";

import { createIssueLog, emptyContext, type PhaseWork } from "@/lib/sales/pipedrive/import-state";

import { db, fakeClient, resetDb, salesWrites, seed, store } from "./import-fakes";

// The users and structure steps, called directly with a hand-built run state.

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { runStructurePhase, runUsersPhase } = await import("@/lib/sales/pipedrive/import-structure");

const FIELD_KEY = "c".repeat(40);
const LEAD_ONLY_KEY = "d".repeat(40);

function work(lists: Record<string, unknown[][]>, live = true): PhaseWork {
  return {
    client: fakeClient(lists).client,
    live,
    starterId: "starter",
    fallback: new Date("2026-11-12T15:00:00Z"),
    cursor: { context: emptyContext(), source: 0, page: null },
    counts: {},
    issues: createIssueLog([]),
    outOfTime: () => false,
    save: async () => true,
  };
}

const structure = {
  "/api/v2/pipelines": [
    [
      { id: 1, name: "Direct Mail", order_nr: 1 },
      { id: 2, name: "Referrals", order_nr: 2 },
      { id: 3, name: "Gone", order_nr: 3, is_deleted: true },
    ],
  ],
  "/api/v2/stages": [
    [
      { id: 20, name: "Asked", pipeline_id: 2, order_nr: 1, deal_probability: 20 },
      { id: 21, name: "Agreed", pipeline_id: 2, order_nr: 2, deal_probability: 90, is_deal_rot_enabled: true, days_to_rotten: 7 },
      { id: 22, name: "Deleted", pipeline_id: 2, order_nr: 3, is_deleted: true },
      { id: 10, name: "New Opt-In", pipeline_id: 1, order_nr: 1 },
    ],
  ],
  "/v1/dealFields": [
    [
      { key: FIELD_KEY, name: "Services", field_type: "set", options: [{ id: 5, label: "Mail" }, { id: 6, label: "Web" }] },
      { key: LEAD_ONLY_KEY, name: "Practice ZIP", field_type: "varchar" },
      { key: "e".repeat(40), name: "Retired", field_type: "varchar", active_flag: false },
    ],
  ],
};

beforeEach(() => {
  resetDb();
  seed(
    "teamMember",
    { id: "starter", name: "Admin A", email: "admin@vp.test", isAdmin: true, canUseSales: true },
    { id: "m1", name: "Ben K", email: "ben@vp.test", isAdmin: false, canUseSales: true },
  );
  seed(
    "salesPipeline",
    { id: "dm", key: "direct-mail", name: "Direct Mail", kind: "SALES", position: 1 },
    { id: "old", key: "referrals", name: "Referrals", kind: "SALES", position: 2, archivedAt: new Date("2026-01-01") },
  );
  seed("salesStage", { id: "s-new", pipelineId: "dm", key: "new-opt-in", name: "New Opt-In", position: 1, isWon: false, isLost: false });
  seed("salesCustomField", {
    id: "f-zip",
    key: "practice-zip",
    label: "Practice ZIP",
    entity: "LEAD",
    fieldType: "TEXT",
    options: [],
    pipelineKeys: [],
    position: 4,
  });
});

describe("runStructurePhase", () => {
  it("creates a pipeline the app does not have, as a sales pipeline with all its stages in order", async () => {
    const w = work(structure);
    expect(await runStructurePhase(w)).toBe("finished");

    const created = store.salesPipeline.find((p) => p.name === "Referrals" && p.archivedAt === null)!;
    // The archived "Referrals" is no match, and its key is taken.
    expect(created).toMatchObject({ key: "referrals-2", kind: "SALES", position: 3 });
    const stages = store.salesStage.filter((s) => s.pipelineId === created.id);
    expect(stages.map((s) => [s.key, s.position, s.probability, s.rottingDays])).toEqual([
      ["asked", 1, 20, 14],
      ["agreed", 2, 90, 7],
    ]);
    const asked = stages[0].id as string;
    expect(w.cursor.context.pipelines).toEqual({
      "1": { pipelineId: "dm", firstStageId: "s-new" },
      "2": { pipelineId: created.id, firstStageId: asked },
    });
    expect(w.cursor.context.stages).toEqual({
      "10": { stageId: "s-new", pipelineId: "dm" },
      "20": { stageId: asked, pipelineId: created.id },
      "21": { stageId: stages[1].id, pipelineId: created.id },
    });
    expect(w.counts).toMatchObject({
      "pipelines.seen": 2,
      "pipelines.unchanged": 1,
      "pipelines.created": 1,
      "stages.seen": 3,
      "stages.created": 2,
      "stages.unchanged": 1,
    });
    expect(w.issues.groups.map((g) => g.message)).toEqual(
      expect.arrayContaining([
        'The Pipedrive pipeline "Referrals" has no match in the app, so it was created as a sales pipeline.',
        'The Pipedrive stage "Asked" in Referrals has no match in the app, so it was created.',
      ]),
    );
  });

  it("matches deal fields by name, finds a lead field with the same name, and makes a multiple choice field a text field", async () => {
    const w = work(structure);
    await runStructurePhase(w);

    const services = store.salesCustomField.find((f) => f.label === "Services")!;
    expect(services).toMatchObject({ key: "services", entity: "DEAL", fieldType: "TEXT", options: [], position: 5 });
    const zip = store.salesCustomField.find((f) => f.label === "Practice ZIP" && f.entity === "DEAL")!;
    expect(zip.key).toBe("practice-zip-2");
    expect(w.cursor.context.fields).toEqual({
      [FIELD_KEY]: { name: "Services", options: { "5": "Mail", "6": "Web" }, dealFieldId: services.id, leadFieldId: null },
      [LEAD_ONLY_KEY]: { name: "Practice ZIP", options: null, dealFieldId: zip.id, leadFieldId: "f-zip" },
    });
    expect(w.counts).toMatchObject({ "customFields.seen": 2, "customFields.created": 2 });
  });

  it("in a practice run, writes nothing and reports what would be created", async () => {
    const w = work(structure, false);
    await runStructurePhase(w);

    expect(salesWrites()).toEqual([]);
    expect(w.cursor.context.pipelines["2"]).toEqual({ pipelineId: null, firstStageId: null });
    expect(w.cursor.context.stages["20"]).toEqual({ stageId: null, pipelineId: null });
    expect(w.cursor.context.fields[FIELD_KEY].dealFieldId).toBeNull();
    expect(w.issues.groups.map((g) => g.message)).toContain(
      'The Pipedrive stage "Agreed" in Referrals has no match in the app, so it would be created.',
    );
  });

  it("matches a second Pipedrive pipeline, stage or field of the same name to the row it just created", async () => {
    const w = work({
      "/api/v2/pipelines": [
        [
          { id: 2, name: "Referrals", order_nr: 1 },
          { id: 4, name: "referrals", order_nr: 2 },
        ],
      ],
      "/api/v2/stages": [
        [
          { id: 20, name: "Asked", pipeline_id: 2, order_nr: 1 },
          { id: 40, name: "Asked", pipeline_id: 4, order_nr: 1 },
        ],
      ],
      "/v1/dealFields": [
        [
          { key: FIELD_KEY, name: "Services", field_type: "varchar" },
          { key: LEAD_ONLY_KEY, name: "services", field_type: "varchar" },
        ],
      ],
    });

    await runStructurePhase(w);

    const created = store.salesPipeline.filter((p) => p.key === "referrals-2");
    expect(created).toHaveLength(1);
    expect(store.salesPipeline).toHaveLength(3);
    expect(store.salesStage.filter((s) => s.pipelineId === created[0].id)).toHaveLength(1);
    expect(w.cursor.context.stages["40"]).toEqual(w.cursor.context.stages["20"]);
    expect(store.salesCustomField.filter((f) => f.label === "Services" || f.label === "services")).toHaveLength(1);
    expect(w.cursor.context.fields[LEAD_ONLY_KEY].dealFieldId).toBe(w.cursor.context.fields[FIELD_KEY].dealFieldId);
    expect(w.counts).toMatchObject({ "pipelines.created": 1, "pipelines.unchanged": 1, "customFields.created": 1, "customFields.unchanged": 1 });
  });

  it("is safe to run again: the second time matches everything it created the first time", async () => {
    await runStructurePhase(work(structure));
    const before = { pipelines: store.salesPipeline.length, stages: store.salesStage.length, fields: store.salesCustomField.length };

    const again = work(structure);
    await runStructurePhase(again);

    expect({ pipelines: store.salesPipeline.length, stages: store.salesStage.length, fields: store.salesCustomField.length }).toEqual(before);
    expect(again.counts).toMatchObject({ "pipelines.unchanged": 2, "stages.unchanged": 3, "customFields.unchanged": 2 });
  });
});

describe("runUsersPhase", () => {
  it("matches users by email or saved choice, and reports the rest", async () => {
    seed("salesImportUserMap", { pipedriveUserId: 3, memberId: "starter" });
    const w = work({
      "/v1/users": [
        [
          { id: 1, name: "Ben", email: "ben@vp.test" },
          { id: 2, name: "Old Rep", email: "old@vp.test" },
          { id: 3, name: "Robert", email: "robert@other.test" },
        ],
      ],
    });

    await runUsersPhase(w);

    expect(w.cursor.context.users).toEqual([
      { id: 1, name: "Ben", email: "ben@vp.test", memberId: "m1" },
      { id: 2, name: "Old Rep", email: "old@vp.test", memberId: null },
      { id: 3, name: "Robert", email: "robert@other.test", memberId: "starter" },
    ]);
    expect(w.counts).toEqual({ "users.seen": 3, "users.unmatched": 1 });
    expect(w.issues.groups).toEqual([
      {
        phase: "users",
        message: "The Pipedrive user Old Rep (old@vp.test) matches no team member, so their records go to the person who started the import.",
        count: 1,
        sampleIds: [2],
      },
    ]);
  });
});
