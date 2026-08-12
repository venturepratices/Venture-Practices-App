import { describe, expect, it } from "vitest";

import { reviveDates, topologicalBatches } from "@/lib/restore-helpers";

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
