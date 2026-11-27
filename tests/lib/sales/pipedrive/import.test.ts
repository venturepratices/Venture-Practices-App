import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PipedriveError } from "@/lib/sales/pipedrive/client";

import { clock, db, fakeClient, resetDb, salesWrites, seed, store, writes } from "./import-fakes";

// The Pipedrive import engine end to end, against an in-memory database and a
// fake Pipedrive. Every number below is exact: the fixture is small enough to
// count by hand.

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { startImportRun, continueImportRun, setUserMapping, loadUserMappings } = await import("@/lib/sales/pipedrive/import");

const COLOR_KEY = "a".repeat(40);
const START_KEY = "b".repeat(40);
const FAR = new Date("2100-01-01T00:00:00.000Z");
const now = () => clock.now;

function pipedrive(overrides: Record<string, unknown[][]> = {}) {
  return {
    "/v1/users": [
      [
        { id: 1, name: "Ben", email: "ben@vp.test" },
        { id: 2, name: "Ghost", email: "ghost@elsewhere.test" },
      ],
    ],
    "/api/v2/pipelines": [[{ id: 1, name: "Direct Mail", order_nr: 1 }]],
    "/api/v2/stages": [
      [
        { id: 10, name: "New Opt-In", pipeline_id: 1, order_nr: 1, deal_probability: 10 },
        { id: 11, name: "Contract Signed", pipeline_id: 1, order_nr: 3, deal_probability: 100 },
        { id: 12, name: "Waiting On Client", pipeline_id: 1, order_nr: 2, deal_probability: 50 },
      ],
    ],
    "/v1/dealFields": [
      [
        { key: "title", name: "Title", field_type: "varchar" },
        { key: COLOR_KEY, name: "Color", field_type: "enum", options: [{ id: 1, label: "Red" }, { id: 2, label: "Blue" }] },
        { key: START_KEY, name: "Target Start Date", field_type: "date" },
      ],
    ],
    "/api/v2/organizations": [
      [
        { id: 100, name: "Oak Dental", owner_id: 1, add_time: "2025-01-01T10:00:00Z" },
        { id: 101, name: "Empty Org", owner_id: 1, add_time: "2025-01-02T10:00:00Z" },
      ],
    ],
    "/api/v2/persons": [
      [
        {
          id: 200,
          name: "Ann P",
          org_id: 100,
          owner_id: 1,
          emails: [{ value: "ann@oak.test", primary: true }],
          add_time: "2025-01-03T10:00:00Z",
        },
      ],
    ],
    "/api/v2/deals": [
      [
        {
          id: 300,
          title: "Oak deal",
          owner_id: 2,
          person_id: 200,
          org_id: 100,
          pipeline_id: 1,
          stage_id: 11,
          status: "won",
          won_time: "2025-03-01T12:00:00Z",
          value: 1000,
          currency: "USD",
          add_time: "2025-02-01T10:00:00Z",
          stage_change_time: "2025-02-20T10:00:00Z",
          custom_fields: { [COLOR_KEY]: 1, [START_KEY]: "2026-12-01" },
        },
      ],
    ],
    "/v1/leads": [[]],
    "/api/v2/activities": [
      [
        {
          id: 400,
          subject: "Kickoff call",
          type: "call",
          done: true,
          marked_as_done_time: null,
          due_date: "2025-03-02",
          due_time: "00:00",
          owner_id: 1,
          deal_id: 300,
          add_time: "2025-03-01T10:00:00Z",
        },
        { id: 401, subject: "Visit", type: "meeting", due_date: "2025-03-05", due_time: "15:00", owner_id: 1, org_id: 100, add_time: "2025-03-01T10:00:00Z" },
        { id: 402, subject: "Lonely", type: "task", due_date: "2025-03-06", owner_id: 1, org_id: 101, add_time: "2025-03-01T10:00:00Z" },
      ],
    ],
    "/v1/notes": [[{ id: 500, content: "<p>Signed &amp; happy</p>", deal_id: 300, user_id: 1, add_time: "2025-03-01 10:00:00" }]],
    ...overrides,
  };
}

function seedApp() {
  seed(
    "teamMember",
    { id: "starter", name: "Admin A", email: "admin@vp.test", isAdmin: true, canUseSales: true },
    { id: "m1", name: "Ben K", email: "ben@vp.test", isAdmin: false, canUseSales: true },
    { id: "m9", name: "No Sales", email: "nosales@vp.test", isAdmin: false, canUseSales: false },
  );
  seed("salesPipeline", { id: "dm", key: "direct-mail", name: "Direct Mail", kind: "SALES", position: 1 });
  seed(
    "salesStage",
    { id: "s-new", pipelineId: "dm", key: "new-opt-in", name: "New Opt-In", position: 1, probability: 10, isWon: false, isLost: false },
    { id: "s-demo", pipelineId: "dm", key: "demo", name: "Demo", position: 2, probability: 30, isWon: false, isLost: false },
    { id: "s-won", pipelineId: "dm", key: "contract-signed", name: "Contract Signed", position: 3, probability: 100, isWon: true, isLost: false },
  );
  seed("salesCustomField", {
    id: "f-start",
    key: "target-start-date",
    label: "Target Start Date",
    entity: "DEAL",
    fieldType: "DATE",
    options: [],
    pipelineKeys: [],
    position: 1,
  });
}

async function startRun(mode: "DRY_RUN" | "LIVE" = "LIVE", isFinal = false) {
  const started = await startImportRun({ mode, isFinal, startedById: "starter" });
  if (!started.ok) throw new Error(started.message);
  return started.runId;
}

async function runToEnd(runId: string, lists = pipedrive()) {
  const { client, calls } = fakeClient(lists);
  const result = await continueImportRun({ runId, client, deadline: FAR, now });
  return { result, calls };
}

function runRow(runId: string) {
  return store.salesImportRun.find((r) => r.id === runId)!;
}

function issuesOf(runId: string) {
  return runRow(runId).issues as { phase: string; message: string; count: number; sampleIds: unknown[] }[];
}

beforeEach(() => {
  resetDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  clock.now = new Date("2026-11-12T15:00:00.000Z");
  vi.setSystemTime(clock.now);
  seedApp();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a practice run (DRY_RUN)", () => {
  it("reads everything, reports counts and issues, and writes nothing to any Sales table", async () => {
    const runId = await startRun("DRY_RUN");
    writes.length = 0;

    const { result } = await runToEnd(runId);

    expect(result).toMatchObject({ done: true, paused: false, phase: "done" });
    expect(salesWrites()).toEqual([]);
    expect(store.salesOrganization).toHaveLength(0);
    expect(store.salesStage).toHaveLength(3);
    expect(result.counts).toMatchObject({
      "users.seen": 2,
      "users.unmatched": 1,
      "pipelines.seen": 1,
      "pipelines.unchanged": 1,
      "stages.seen": 3,
      "stages.unchanged": 2,
      "stages.created": 1,
      // Color needs a deal field and a lead field; Target Start Date matches a deal field but needs a lead field.
      "customFields.seen": 2,
      "customFields.created": 2,
      "customFields.leadCreated": 2,
      "organizations.seen": 2,
      "organizations.created": 2,
      "persons.created": 1,
      "deals.created": 1,
      "activities.seen": 3,
      // A practice run does not look for an organization's people, so nothing is skipped for it.
      "activities.created": 3,
      "notes.created": 1,
      activitiesAtMidnightUtc: 1,
    });
    const messages = issuesOf(runId).map((i) => i.message);
    expect(messages).toContain('The Pipedrive stage "Waiting On Client" in Direct Mail has no match in the app, so it would be created.');
    expect(messages).toContain('The Pipedrive deal field "Color" has no match in the app, so it would be created.');
    expect(messages).toContain('The Pipedrive field "Color" has no lead field in the app, so a lead field would be created for its values on leads.');
    expect(messages).toContain(
      'The Pipedrive field "Target Start Date" has no lead field in the app, so a lead field would be created for its values on leads.',
    );
    expect(store.salesCustomField).toHaveLength(1);
    expect(messages).toContain("The owner in Pipedrive matches no team member, so the person who started the import owns it.");
    expect(runRow(runId)).toMatchObject({ status: "DONE", finishedAt: clock.now });
  });
});

describe("a real run (LIVE)", () => {
  it("creates organizations, people and deals in that order with the right links", async () => {
    const runId = await startRun();
    writes.length = 0;
    await runToEnd(runId);

    const order = salesWrites().filter((w) => w.op === "createMany").map((w) => w.table);
    expect(order.indexOf("salesOrganization")).toBeLessThan(order.indexOf("salesPerson"));
    expect(order.indexOf("salesPerson")).toBeLessThan(order.indexOf("salesDeal"));

    const oak = store.salesOrganization.find((o) => o.pipedriveId === 100)!;
    expect(oak).toMatchObject({ name: "Oak Dental", nameKey: "oakdental", ownerId: "m1", createdAt: new Date("2025-01-01T10:00:00Z") });
    const ann = store.salesPerson.find((p) => p.pipedriveId === 200)!;
    expect(ann).toMatchObject({ organizationId: oak.id, ownerId: "m1", email: "ann@oak.test", emailKey: "ann@oak.test" });

    const deal = store.salesDeal.find((d) => d.pipedriveId === 300)!;
    expect(deal).toMatchObject({
      title: "Oak deal",
      personId: ann.id,
      organizationId: oak.id,
      pipelineId: "dm",
      // A won deal keeps its own stage and gets WON with its won time.
      stageId: "s-won",
      status: "WON",
      wonAt: new Date("2025-03-01T12:00:00Z"),
      valueCents: 100_000,
      // Ghost matches no team member, so the person who started the run owns it.
      ownerId: "starter",
      createdAt: new Date("2025-02-01T10:00:00Z"),
    });
    expect(issuesOf(runId)).toContainEqual({
      phase: "deals",
      message: "The owner in Pipedrive matches no team member, so the person who started the import owns it.",
      count: 1,
      sampleIds: [300],
    });

    expect(store.salesAuditLog).toEqual([
      expect.objectContaining({ actorType: "SYSTEM", actorId: null, entityType: "SalesDeal", entityId: deal.id, action: "imported" }),
    ]);
  });

  it("creates a missing stage before the won stage, with an issue", async () => {
    const runId = await startRun();
    await runToEnd(runId);

    const stages = store.salesStage.filter((s) => s.pipelineId === "dm").sort((a, b) => (a.position as number) - (b.position as number));
    expect(stages.map((s) => [s.name, s.position])).toEqual([
      ["New Opt-In", 1],
      ["Demo", 2],
      ["Waiting On Client", 3],
      ["Contract Signed", 4],
    ]);
    expect(stages[2]).toMatchObject({ key: "waiting-on-client", probability: 50, isWon: false, isLost: false });
    expect(issuesOf(runId)).toContainEqual({
      phase: "structure",
      message: 'The Pipedrive stage "Waiting On Client" in Direct Mail has no match in the app, so it was created.',
      count: 1,
      sampleIds: [12],
    });
  });

  it("saves custom values as text, option ids as their labels, and makes a field the app does not have", async () => {
    const runId = await startRun();
    await runToEnd(runId);

    const color = store.salesCustomField.find((f) => f.label === "Color")!;
    expect(color).toMatchObject({ key: "color", entity: "DEAL", fieldType: "SELECT", options: ["Red", "Blue"], position: 2 });
    const deal = store.salesDeal[0];
    const values = store.salesCustomFieldValue.map((v) => [v.fieldId, v.dealId, v.value]);
    expect(values).toEqual(
      expect.arrayContaining([
        [color.id, deal.id, "Red"],
        ["f-start", deal.id, "2026-12-01"],
      ]),
    );
    expect(values).toHaveLength(2);
  });

  it("makes a lead field for a Pipedrive field the app only has as a deal field, and copies the lead's value into it", async () => {
    const lists = pipedrive({
      "/v1/leads": [
        [{ id: "uuid-1", title: "Oak lead", owner_id: 1, add_time: "2025-01-01T00:00:00Z", [START_KEY]: "2026-12-05", [COLOR_KEY]: 2 }],
      ],
    });
    const runId = await startRun();
    const { result } = await runToEnd(runId, lists);

    const start = store.salesCustomField.find((f) => f.label === "Target Start Date" && f.entity === "LEAD")!;
    const color = store.salesCustomField.find((f) => f.label === "Color" && f.entity === "LEAD")!;
    // The deal field already holds the plain key, so the lead twin gets its own.
    expect(start).toMatchObject({ key: "target-start-date-lead", fieldType: "DATE", options: [], archivedAt: null });
    expect(color).toMatchObject({ key: "color-lead", fieldType: "SELECT", options: ["Red", "Blue"], archivedAt: null });
    expect(store.salesCustomField.filter((f) => f.entity === "DEAL").map((f) => f.key)).toEqual(["target-start-date", "color"]);

    const lead = store.salesLead[0];
    expect(store.salesCustomFieldValue.filter((v) => v.leadId === lead.id).map((v) => [v.fieldId, v.value]).sort()).toEqual(
      [
        [start.id, "2026-12-05"],
        [color.id, "Blue"],
      ].sort(),
    );
    expect(issuesOf(runId).filter((i) => i.message.includes("values on leads were not copied"))).toEqual([]);
    expect(result.counts).toMatchObject({ "customFields.leadCreated": 2, "leads.created": 1 });

    // Run again: the lead fields are found by name, so nothing is made and nothing changes.
    clock.now = new Date("2026-11-12T16:00:00.000Z");
    vi.setSystemTime(clock.now);
    const second = await startRun();
    writes.length = 0;
    const again = await runToEnd(second, lists);
    expect(salesWrites().filter((w) => w.table !== "salesAuditLog")).toEqual([]);
    // The seeded deal field, plus Color (deal), Target Start Date (lead) and Color (lead).
    expect(store.salesCustomField).toHaveLength(4);
    expect(again.result.counts).toMatchObject({ "customFields.unchanged": 2, "leads.unchanged": 1 });
    expect(again.result.counts["customFields.created"]).toBeUndefined();
    expect(again.result.counts["customFields.leadCreated"]).toBeUndefined();
  });

  it("in a practice run, reports the lead field it would make and does not call the lead's value lost", async () => {
    const lists = pipedrive({
      "/v1/leads": [[{ id: "uuid-1", title: "Oak lead", owner_id: 1, add_time: "2025-01-01T00:00:00Z", [START_KEY]: "2026-12-05" }]],
    });
    const runId = await startRun("DRY_RUN");
    writes.length = 0;
    const { result } = await runToEnd(runId, lists);

    expect(salesWrites()).toEqual([]);
    expect(store.salesCustomField).toHaveLength(1);
    expect(store.salesLead).toHaveLength(0);
    expect(result.counts).toMatchObject({ "leads.created": 1, "customFields.leadCreated": 2 });
    const messages = issuesOf(runId).map((i) => i.message);
    expect(messages).toContain(
      'The Pipedrive field "Target Start Date" has no lead field in the app, so a lead field would be created for its values on leads.',
    );
    expect(messages.filter((m) => m.includes("values on leads were not copied"))).toEqual([]);
  });

  it("imports a done activity with no done time, moves an organization-only one to its first person, and skips one on an organization with no people", async () => {
    const runId = await startRun();
    const { result } = await runToEnd(runId);

    const started = runRow(runId).startedAt as Date;
    const deal = store.salesDeal[0];
    const ann = store.salesPerson[0];
    expect(store.salesActivity.find((a) => a.pipedriveId === 400)).toMatchObject({
      dealId: deal.id,
      doneAt: started,
      ownerId: "m1",
      createdBy: "import:pipedrive",
      hasTime: true,
    });
    expect(store.salesActivity.find((a) => a.pipedriveId === 401)).toMatchObject({ personId: ann.id, dealId: null });
    expect(store.salesActivity.find((a) => a.pipedriveId === 402)).toBeUndefined();
    expect(result.counts).toMatchObject({ "activities.seen": 3, "activities.created": 2, "activities.skipped": 1, activitiesAtMidnightUtc: 1 });
    expect(issuesOf(runId)).toContainEqual({
      phase: "activities",
      message: "The activity was only on an organization with no people, so it was not copied.",
      count: 1,
      sampleIds: [402],
    });
    expect(store.salesNote[0]).toMatchObject({ body: "Signed & happy", authorId: "m1", dealId: deal.id, pipedriveId: 500 });
  });

  it("a second run creates nothing and reports every row unchanged", async () => {
    await runToEnd(await startRun());
    clock.now = new Date("2026-11-12T16:00:00.000Z");
    vi.setSystemTime(clock.now);
    const second = await startRun();
    writes.length = 0;

    const { result } = await runToEnd(second);

    const rowWrites = salesWrites().filter((w) => w.table !== "salesAuditLog");
    expect(rowWrites).toEqual([]);
    expect(store.salesAuditLog).toHaveLength(1);
    expect(result.counts).toMatchObject({
      "organizations.unchanged": 2,
      "persons.unchanged": 1,
      "deals.unchanged": 1,
      "activities.unchanged": 2,
      "notes.unchanged": 1,
      "stages.unchanged": 3,
      "customFields.unchanged": 2,
    });
    expect(Object.keys(result.counts).filter((k) => k.endsWith(".created") || k.endsWith(".updated"))).toEqual([]);
  });

  it("a later run updates only what changed in Pipedrive, with an import_updated history row", async () => {
    await runToEnd(await startRun());
    const second = await startRun();
    const lists = pipedrive();
    (lists["/api/v2/deals"][0][0] as Record<string, unknown>).title = "Oak deal renamed";

    const { result } = await runToEnd(second, lists);

    expect(store.salesDeal[0].title).toBe("Oak deal renamed");
    expect(result.counts).toMatchObject({ "deals.updated": 1 });
    expect(store.salesAuditLog.at(-1)).toMatchObject({
      action: "import_updated",
      entityType: "SalesDeal",
      before: { title: "Oak deal" },
      after: { title: "Oak deal renamed" },
    });
  });

});

describe("startImportRun", () => {
  it("refuses a second run while one is running, and frees a run that went quiet", async () => {
    const first = await startRun();

    const again = await startImportRun({ mode: "LIVE", isFinal: false, startedById: "starter" });
    expect(again).toEqual({ ok: false, message: "An import is already running. Wait for it to finish, or press Keep going." });

    clock.now = new Date(clock.now.getTime() + 6 * 60_000);
    vi.setSystemTime(clock.now);
    const later = await startImportRun({ mode: "DRY_RUN", isFinal: false, startedById: "starter" });
    expect(later.ok).toBe(true);
    expect(runRow(first)).toMatchObject({ status: "FAILED", finishedAt: clock.now });
    expect(store.salesImportRun.filter((r) => r.status === "RUNNING")).toHaveLength(1);
  });

  it("answers in plain words when two starts race and the database refuses the second", async () => {
    db.salesImportRun.create.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    expect(await startImportRun({ mode: "LIVE", isFinal: false, startedById: "starter" })).toEqual({
      ok: false,
      message: "An import is already running. Wait for it to finish, or press Keep going.",
    });
  });

  it("refuses a final practice run, and any real or final run once a final run is done", async () => {
    expect(await startImportRun({ mode: "DRY_RUN", isFinal: true, startedById: "starter" })).toEqual({
      ok: false,
      message: "A practice run cannot be the final run.",
    });
    seed("salesImportRun", { mode: "LIVE", isFinal: true, status: "DONE", phase: "done", counts: {}, issues: [], startedById: "starter" });

    const locked = { ok: false, message: "The import is locked. Pipedrive was switched off." };
    expect(await startImportRun({ mode: "LIVE", isFinal: false, startedById: "starter" })).toEqual(locked);
    expect(await startImportRun({ mode: "LIVE", isFinal: true, startedById: "starter" })).toEqual(locked);
    expect((await startImportRun({ mode: "DRY_RUN", isFinal: false, startedById: "starter" })).ok).toBe(true);
  });

  it("does not lock later real runs when a final run failed", async () => {
    seed("salesImportRun", { mode: "LIVE", isFinal: true, status: "FAILED", phase: "deals", counts: {}, issues: [], startedById: "starter" });
    expect((await startImportRun({ mode: "LIVE", isFinal: false, startedById: "starter" })).ok).toBe(true);
  });

  it("starts a run at the users step with empty counts and issues", async () => {
    const runId = await startRun("LIVE", true);
    expect(runRow(runId)).toMatchObject({
      mode: "LIVE",
      isFinal: true,
      status: "RUNNING",
      phase: "users",
      counts: {},
      issues: [],
      startedById: "starter",
    });
  });
});

describe("continueImportRun", () => {
  it("stops when time runs out, saves its place, and the next call carries on without re-reading finished pages", async () => {
    const runId = await startRun();
    const lists = pipedrive({
      "/api/v2/organizations": [
        [{ id: 100, name: "Oak Dental", owner_id: 1 }],
        [{ id: 101, name: "Empty Org", owner_id: 1 }],
      ],
    });
    const deadline = new Date(clock.now.getTime() + 60_000);
    const first = fakeClient(lists, {
      onPage: (path) => {
        if (path === "/api/v2/organizations") clock.now = new Date(deadline.getTime() + 1);
      },
    });

    const stopped = await continueImportRun({ runId, client: first.client, deadline, now });

    expect(stopped).toMatchObject({ done: false, paused: false, phase: "organizations" });
    expect(runRow(runId)).toMatchObject({ status: "RUNNING", phase: "organizations" });
    expect((runRow(runId).cursor as { page: unknown }).page).toEqual({ cursor: "p1" });
    expect(store.salesOrganization.map((o) => o.pipedriveId)).toEqual([100]);

    const second = fakeClient(lists);
    const finished = await continueImportRun({ runId, client: second.client, deadline: FAR, now });

    expect(finished.done).toBe(true);
    const orgCalls = second.calls.filter((c) => c.path === "/api/v2/organizations");
    expect(orgCalls).toEqual([{ path: "/api/v2/organizations", resumeAt: { cursor: "p1" }, limit: 100, style: "cursor" }]);
    // Users and structure were done in the first call and are not read again.
    expect(second.calls.map((c) => c.path)).not.toContain("/v1/users");
    expect(store.salesOrganization.map((o) => o.pipedriveId)).toEqual([100, 101]);
    expect(finished.counts["organizations.seen"]).toBe(2);
  });

  it("does nothing past a deadline that has already gone by, and keeps the run as it was", async () => {
    const runId = await startRun();
    const { client, calls } = fakeClient(pipedrive());
    const result = await continueImportRun({ runId, client, deadline: new Date(clock.now.getTime() - 1), now });
    expect(result).toEqual({ done: false, paused: false, phase: "users", counts: {} });
    expect(calls).toEqual([]);
    expect(runRow(runId).status).toBe("RUNNING");
  });

  it("pauses on Pipedrive's rate limit with its place saved, then finishes on the next call", async () => {
    const runId = await startRun();
    const limited = fakeClient(pipedrive(), {
      failOn: { "/api/v2/deals": new PipedriveError(429, "Pipedrive request failed (HTTP 429): Pipedrive is rate limiting this token.") },
    });

    const paused = await continueImportRun({ runId, client: limited.client, deadline: FAR, now });

    expect(paused).toMatchObject({ done: false, paused: true, phase: "deals" });
    expect(runRow(runId)).toMatchObject({ status: "RUNNING", phase: "deals" });
    expect(store.salesPerson).toHaveLength(1);

    const { result } = await runToEnd(runId);
    expect(result.done).toBe(true);
    expect(store.salesDeal).toHaveLength(1);
    expect(result.counts["persons.seen"]).toBe(1);
  });

  it("marks the run failed in plain words on any other Pipedrive error", async () => {
    const runId = await startRun();
    const broken = fakeClient(pipedrive(), {
      failOn: { "/v1/users": new PipedriveError(401, "Pipedrive request failed (HTTP 401): Pipedrive did not accept the API token.") },
    });

    const result = await continueImportRun({ runId, client: broken.client, deadline: FAR, now });

    expect(result).toMatchObject({ done: false, paused: false, phase: "users" });
    expect(runRow(runId)).toMatchObject({ status: "FAILED", finishedAt: clock.now });
    expect(issuesOf(runId)).toEqual([
      {
        phase: "users",
        message: "The copy stopped: Pipedrive request failed (HTTP 401): Pipedrive did not accept the API token.",
        count: 1,
        sampleIds: [],
      },
    ]);
  });

  it("closes the run in plain words when its saved place does not fit the list, instead of leaving it stuck", async () => {
    const [run] = seed("salesImportRun", {
      mode: "LIVE",
      status: "RUNNING",
      phase: "organizations",
      cursor: { context: { users: [], stages: {}, pipelines: {}, fields: {} }, source: 0, page: { start: 300 } },
      counts: {},
      issues: [],
      startedById: "starter",
    });
    const { client } = fakeClient(pipedrive());

    const result = await continueImportRun({ runId: run.id as string, client, deadline: FAR, now });

    expect(result).toMatchObject({ done: false, paused: false, phase: "organizations" });
    expect(runRow(run.id as string)).toMatchObject({ status: "FAILED", finishedAt: clock.now });
    expect(issuesOf(run.id as string)).toEqual([
      { phase: "organizations", message: "The copy stopped: The saved page position does not fit this list.", count: 1, sampleIds: [] },
    ]);
  });

  it("refuses a run that is not running, and one that does not exist", async () => {
    const [done] = seed("salesImportRun", { mode: "LIVE", status: "DONE", phase: "done", counts: {}, issues: [], startedById: "starter" });
    const { client } = fakeClient(pipedrive());
    await expect(continueImportRun({ runId: done.id as string, client, deadline: FAR, now })).rejects.toThrow(
      "This import is not running, so it cannot continue.",
    );
    await expect(continueImportRun({ runId: "nope", client, deadline: FAR, now })).rejects.toThrow("That import run was not found.");
  });

  it("stops at once when another request has taken the run over, so two admins never write over each other", async () => {
    const runId = await startRun();
    const { client } = fakeClient(pipedrive(), {
      onPage: (path) => {
        // Another request saves the run while this one is reading organizations.
        if (path === "/api/v2/organizations") {
          const row = runRow(runId);
          row.updatedAt = new Date(clock.now.getTime() + 5);
        }
      },
    });

    const result = await continueImportRun({ runId, client, deadline: FAR, now });

    expect(result.done).toBe(false);
    expect(runRow(runId).phase).toBe("organizations");
    expect(store.salesPerson).toHaveLength(0);
  });
});

describe("user mappings", () => {
  it("lists the Pipedrive users of the latest run with their match, and a saved choice wins", async () => {
    await runToEnd(await startRun("DRY_RUN"));

    expect(await loadUserMappings()).toEqual([
      { pipedriveUserId: 1, name: "Ben", email: "ben@vp.test", memberId: "m1", memberName: "Ben K", auto: true },
      { pipedriveUserId: 2, name: "Ghost", email: "ghost@elsewhere.test", memberId: null, memberName: null, auto: false },
    ]);

    await setUserMapping({ pipedriveUserId: 2, memberId: "starter" });
    expect((await loadUserMappings())[1]).toEqual({
      pipedriveUserId: 2,
      name: "Ghost",
      email: "ghost@elsewhere.test",
      memberId: "starter",
      memberName: "Admin A",
      auto: false,
    });
    expect(store.salesImportUserMap).toEqual([expect.objectContaining({ pipedriveUserId: 2, memberId: "starter" })]);
  });

  it("refuses a team member who cannot own Sales records", async () => {
    await expect(setUserMapping({ pipedriveUserId: 2, memberId: "m9" })).rejects.toThrow("That team member cannot own Sales records.");
  });

  it("gives an empty list before any run has read the users", async () => {
    expect(await loadUserMappings()).toEqual([]);
  });
});
