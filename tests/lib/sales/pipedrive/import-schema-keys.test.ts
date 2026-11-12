import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clock, db, fakeClient, resetDb, seed, writes } from "./import-fakes";

// The in-memory database accepts any column name, so a typo or a later column
// rename would pass every other import test. This one runs a full real import
// (and a second run that updates rows) over records that touch every kind of
// write, then checks every column name the engine wrote against the real
// schema. The generated Prisma 7 client carries no dmmf, so the schema file
// itself is read.

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { startImportRun, continueImportRun, setUserMapping } = await import("@/lib/sales/pipedrive/import");

/** Model name to the names of its scalar (non-relation) fields, from prisma/schema.prisma. */
function scalarFields(): Map<string, Set<string>> {
  const schema = fs.readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const blocks = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const modelNames = new Set(blocks.map((b) => b[1]));
  const out = new Map<string, Set<string>>();
  for (const [, model, body] of blocks) {
    const fields = new Set<string>();
    for (const line of body.split("\n")) {
      const match = /^\s*(\w+)\s+(\w+)(\[\]|\?)?/.exec(line);
      if (!match || line.trim().startsWith("//") || line.trim().startsWith("@@")) continue;
      if (!modelNames.has(match[2])) fields.add(match[1]);
    }
    out.set(model, fields);
  }
  return out;
}

const COLOR_KEY = "a".repeat(40);
const ZIP_KEY = "b".repeat(40);
const FAR = new Date("2100-01-01T00:00:00.000Z");
const now = () => clock.now;

function lists(dealTitle: string, zip: string) {
  return {
    "/api/v1/users": [[{ id: 1, name: "Ben", email: "ben@vp.test" }]],
    "/api/v2/pipelines": [
      [
        { id: 1, name: "Direct Mail", order_nr: 1 },
        { id: 2, name: "Referrals", order_nr: 2 },
      ],
    ],
    "/api/v2/stages": [
      [
        { id: 10, name: "New Opt-In", pipeline_id: 1, order_nr: 1 },
        { id: 11, name: "Waiting", pipeline_id: 1, order_nr: 2 },
        { id: 20, name: "Asked", pipeline_id: 2, order_nr: 1 },
      ],
    ],
    "/api/v1/dealFields": [
      [
        { key: COLOR_KEY, name: "Color", field_type: "enum", options: [{ id: 1, label: "Red" }] },
        { key: ZIP_KEY, name: "Practice ZIP", field_type: "varchar" },
      ],
    ],
    "/api/v2/organizations": [[{ id: 100, name: "Oak Dental", owner_id: 1, add_time: "2025-01-01T00:00:00Z" }]],
    "/api/v2/persons": [[{ id: 200, name: "Ann P", org_id: 100, owner_id: 1, add_time: "2025-01-01T00:00:00Z" }]],
    "/api/v2/deals": [
      [
        {
          id: 300,
          title: dealTitle,
          owner_id: 1,
          person_id: 200,
          org_id: 100,
          pipeline_id: 1,
          stage_id: 11,
          status: "open",
          value: 10,
          add_time: "2025-01-01T00:00:00Z",
          custom_fields: { [COLOR_KEY]: 1, [ZIP_KEY]: zip },
        },
      ],
    ],
    "/api/v2/deals/archived": [[]],
    "/api/v1/leads": [[{ id: "u-1", title: "Lead", owner_id: 1, person_id: 200, add_time: "2025-01-01T00:00:00Z", [ZIP_KEY]: zip }]],
    "/api/v1/leads/archived": [[]],
    "/api/v2/activities": [
      [{ id: 400, subject: dealTitle, type: "call", due_date: "2025-01-02", owner_id: 1, deal_id: 300, add_time: "2025-01-01T00:00:00Z" }],
    ],
    "/api/v1/notes": [[{ id: 500, content: dealTitle, deal_id: 300, user_id: 1, add_time: "2025-01-01 00:00:00" }]],
  };
}

beforeEach(() => {
  resetDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  clock.now = new Date("2026-11-12T15:00:00.000Z");
  vi.setSystemTime(clock.now);
  seed(
    "teamMember",
    { id: "starter", name: "Admin A", email: "admin@vp.test", isAdmin: true, canUseSales: true },
    { id: "m1", name: "Ben K", email: "ben@vp.test", isAdmin: false, canUseSales: true },
  );
  seed("salesPipeline", { id: "dm", key: "direct-mail", name: "Direct Mail", kind: "SALES", position: 1 });
  seed(
    "salesStage",
    { id: "s-new", pipelineId: "dm", key: "new-opt-in", name: "New Opt-In", position: 1, isWon: false, isLost: false },
    { id: "s-won", pipelineId: "dm", key: "won", name: "Won", position: 2, isWon: true, isLost: false },
  );
  seed("salesCustomField", { id: "f-zip", key: "practice-zip", label: "Practice ZIP", entity: "LEAD", fieldType: "TEXT", options: [], pipelineKeys: [], position: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("every column the import writes exists in the schema", () => {
  it("covers creates, updates and the run row, and names only real scalar fields", async () => {
    for (const [title, zip] of [
      ["First", "28202"],
      ["Second", "28203"],
    ]) {
      const started = await startImportRun({ mode: "LIVE", isFinal: false, startedById: "starter" });
      if (!started.ok) throw new Error(started.message);
      const result = await continueImportRun({ runId: started.runId, client: fakeClient(lists(title, zip)).client, deadline: FAR, now });
      expect(result.done).toBe(true);
    }
    // A run that went quiet is closed by the next start (a conditional update on the run row).
    await startImportRun({ mode: "DRY_RUN", isFinal: false, startedById: "starter" });
    clock.now = new Date(clock.now.getTime() + 10 * 60_000);
    vi.setSystemTime(clock.now);
    await startImportRun({ mode: "DRY_RUN", isFinal: false, startedById: "starter" });
    await setUserMapping({ pipedriveUserId: 1, memberId: "m1" });

    const schema = scalarFields();
    const written = new Map<string, Set<string>>();
    for (const w of writes) {
      const model = w.table[0].toUpperCase() + w.table.slice(1);
      const set = written.get(`${model} ${w.op}`) ?? new Set<string>();
      for (const key of w.keys) set.add(key);
      written.set(`${model} ${w.op}`, set);
    }

    const unknown = [...written].flatMap(([where, keys]) =>
      [...keys].filter((key) => !schema.get(where.split(" ")[0])?.has(key)).map((key) => `${where}: ${key}`),
    );
    expect(unknown).toEqual([]);

    // Every kind of write the import makes was exercised, so the check above covered it.
    expect([...written.keys()].sort()).toEqual(
      [
        "SalesActivity createMany",
        "SalesActivity update",
        "SalesAuditLog createMany",
        "SalesCustomField createMany",
        "SalesCustomFieldValue createMany",
        "SalesCustomFieldValue update",
        "SalesDeal createMany",
        "SalesDeal update",
        "SalesImportRun create",
        "SalesImportRun updateMany",
        "SalesImportUserMap upsert",
        "SalesLead createMany",
        "SalesNote createMany",
        "SalesNote update",
        "SalesOrganization createMany",
        "SalesPerson createMany",
        "SalesPipeline create",
        "SalesStage createMany",
        "SalesStage updateMany",
      ].sort(),
    );
  });
});
