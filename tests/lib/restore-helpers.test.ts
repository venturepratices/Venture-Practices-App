import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BACKUP_MODEL_KEYS } from "@/lib/backup";
import {
  missingV3Tables,
  reviveDates,
  snapshotHasTable,
  topologicalBatches,
  V3_SNAPSHOT_TABLES,
} from "@/lib/restore-helpers";

describe("reviveDates", () => {
  it("turns an ISO date string into a real Date", () => {
    const revived = reviveDates("createdAt", "2026-08-12T10:30:00.000Z");
    expect(revived).toBeInstanceOf(Date);
    expect((revived as Date).toISOString()).toBe("2026-08-12T10:30:00.000Z");
  });

  it("accepts an ISO string with a timezone offset instead of Z", () => {
    const revived = reviveDates("createdAt", "2026-08-12T10:30:00+02:00");
    expect(revived).toBeInstanceOf(Date);
  });

  it("leaves a plain string untouched", () => {
    expect(reviveDates("title", "Just a task title")).toBe("Just a task title");
  });

  it("leaves a string that merely looks date-ish but isn't full ISO untouched", () => {
    expect(reviveDates("date", "2026-08-12")).toBe("2026-08-12");
  });

  it("leaves non-string values untouched", () => {
    expect(reviveDates("count", 5)).toBe(5);
    expect(reviveDates("active", true)).toBe(true);
    expect(reviveDates("meta", null)).toBe(null);
  });
});

type Row = { id: string; parentId: string | null };

function idsOf(batch: Row[]): string[] {
  return batch.map((r) => r.id).sort();
}

describe("topologicalBatches", () => {
  it("puts every parentless row in the first batch", () => {
    const rows: Row[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: null },
    ];
    const batches = topologicalBatches(rows, "parentId");
    expect(batches).toHaveLength(1);
    expect(idsOf(batches[0])).toEqual(["a", "b"]);
  });

  it("orders a parent strictly before its child, across batches", () => {
    const rows: Row[] = [
      { id: "child", parentId: "root" },
      { id: "root", parentId: null },
    ];
    const batches = topologicalBatches(rows, "parentId");
    expect(batches).toHaveLength(2);
    expect(idsOf(batches[0])).toEqual(["root"]);
    expect(idsOf(batches[1])).toEqual(["child"]);
  });

  it("handles a multi-level thread (grandparent -> parent -> child) in three batches", () => {
    const rows: Row[] = [
      { id: "grandchild", parentId: "child" },
      { id: "root", parentId: null },
      { id: "child", parentId: "root" },
    ];
    const batches = topologicalBatches(rows, "parentId");
    expect(batches.map(idsOf)).toEqual([["root"], ["child"], ["grandchild"]]);
  });

  it("treats a parentId pointing OUTSIDE this row set as if it had no parent (already exists in the DB)", () => {
    const rows: Row[] = [{ id: "reply", parentId: "some-comment-from-a-different-batch" }];
    const batches = topologicalBatches(rows, "parentId");
    expect(batches).toEqual([rows]);
  });

  it("never drops a row, even under an unexpected cycle — bails out into one final batch instead of hanging", () => {
    const rows: Row[] = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    const batches = topologicalBatches(rows, "parentId");
    const allIds = batches.flat().map((r) => r.id).sort();
    expect(allIds).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty row set", () => {
    expect(topologicalBatches([], "parentId")).toEqual([]);
  });
});

describe("older snapshots (v1/v2) without the v3 tables", () => {
  const v2Tables = { teamMembers: [], tasks: [] } as Record<string, unknown>;
  const v3Tables = Object.fromEntries(V3_SNAPSHOT_TABLES.map(({ key }) => [key, []])) as Record<string, unknown>;

  it("reports every v3 table as missing from a v2 snapshot", () => {
    expect(missingV3Tables(v2Tables)).toHaveLength(V3_SNAPSHOT_TABLES.length);
    expect(snapshotHasTable(v2Tables, "taskStatusOptions")).toBe(false);
  });

  it("reports nothing missing from a v3 snapshot, even when the tables are empty", () => {
    expect(missingV3Tables(v3Tables)).toEqual([]);
    expect(snapshotHasTable(v3Tables, "issues")).toBe(true);
  });

  it("only lists keys that the backup actually writes", () => {
    for (const { model } of V3_SNAPSHOT_TABLES) expect(BACKUP_MODEL_KEYS).toContain(model);
  });

  it("restore script wipes each v3 table only when the snapshot has it", () => {
    const script = readFileSync(join(__dirname, "../../scripts/restore-from-backup.ts"), "utf8");
    for (const { key, model } of V3_SNAPSHOT_TABLES) {
      expect(script, key).toContain(`if (has("${key}")) await tx.${model}.deleteMany();`);
      expect(script, key).not.toMatch(new RegExp(String.raw`^\s*await tx\.${model}\.deleteMany\(\);`, "m"));
    }
  });
});

describe("Sales tables in the restore script", () => {
  const script = readFileSync(join(__dirname, "../../scripts/restore-from-backup.ts"), "utf8");
  // [snapshot key, Prisma delegate], in the order they must be inserted.
  const SALES = [
    ["salesPipelines", "salesPipeline"],
    ["salesStages", "salesStage"],
    ["salesOrganizations", "salesOrganization"],
    ["salesPeople", "salesPerson"],
    ["salesDeals", "salesDeal"],
    ["salesLeads", "salesLead"],
    ["salesActivities", "salesActivity"],
    ["salesNotes", "salesNote"],
    ["salesFiles", "salesFile"],
    ["salesCustomFields", "salesCustomField"],
    ["salesCustomFieldValues", "salesCustomFieldValue"],
  ] as const;
  const at = (needle: string) => {
    const i = script.indexOf(needle);
    expect(i, needle).toBeGreaterThan(-1);
    return i;
  };

  it("wipes, inserts and counts every Sales table", () => {
    for (const [key, model] of SALES) {
      expect(BACKUP_MODEL_KEYS, model).toContain(model);
      at(`await tx.${model}.deleteMany();`);
      at(`await tx.${model}.createMany({ data: t.${key} as never });`);
      at(`${key}: await prisma.${model}.count(),`);
    }
  });

  it("inserts parents before children and wipes children before parents", () => {
    const inserts = SALES.map(([key, model]) => at(`await tx.${model}.createMany({ data: t.${key} as never });`));
    const wipes = SALES.map(([, model]) => at(`await tx.${model}.deleteMany();`));
    expect(inserts).toEqual([...inserts].sort((a, b) => a - b));
    expect(wipes).toEqual([...wipes].sort((a, b) => b - a));
  });

  it("wipes Sales before TeamMember and inserts it after, because every Sales owner link is Restrict", () => {
    expect(at("await tx.salesPipeline.deleteMany();")).toBeLessThan(at("await tx.teamMember.deleteMany();"));
    expect(at("await tx.salesPipeline.createMany")).toBeGreaterThan(at("await tx.teamMember.createMany"));
  });
});

describe("Sales history log in the restore script", () => {
  const script = readFileSync(join(__dirname, "../../scripts/restore-from-backup.ts"), "utf8");

  it("never wipes the locked history log", () => {
    expect(script).not.toMatch(/salesAuditLog.deleteMany/);
  });

  it("adds missing history rows back without failing on rows that already exist", () => {
    expect(script).toContain(
      "await tx.salesAuditLog.createMany({ data: t.salesAuditLogs as never, skipDuplicates: true });",
    );
  });

  it("counts the history log after the restore", () => {
    expect(script).toContain("salesAuditLogs: await prisma.salesAuditLog.count(),");
  });
});
