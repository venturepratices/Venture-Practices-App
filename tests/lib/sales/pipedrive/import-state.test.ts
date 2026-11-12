import { describe, expect, it } from "vitest";

import {
  createIssueLog,
  ISSUE_GROUPS_MAX,
  issueKind,
  nextPhase,
  readCursor,
  readIssueGroups,
  type IssueGroup,
} from "@/lib/sales/pipedrive/import-state";

// The import's issue list, counts and saved cursor: pure, so every rule is
// checked here directly with exact values.

describe("issueKind", () => {
  it("takes out quoted text and numbers, so the same sentence about other values is one kind", () => {
    expect(issueKind('"a@b" is not an email address, so it was not copied.')).toBe('"" is not an email address, so it was not copied.');
    expect(issueKind("The deal value was negative (-5), so it was set to $0.")).toBe(
      "The deal value was negative (-#), so it was set to $#.",
    );
  });
});

describe("createIssueLog", () => {
  it("groups by step and kind, counts each, and keeps the first three ids once each", () => {
    const log = createIssueLog([]);
    log.add({ phase: "persons", pipedriveId: 1, message: '"x" is not an email address, so it was not copied.' });
    log.add({ phase: "persons", pipedriveId: 2, message: '"y" is not an email address, so it was not copied.' });
    log.add({ phase: "persons", pipedriveId: 2, message: '"z" is not an email address, so it was not copied.' });
    log.add({ phase: "persons", pipedriveId: 3, message: '"w" is not an email address, so it was not copied.' });
    log.add({ phase: "persons", pipedriveId: 4, message: '"v" is not an email address, so it was not copied.' });
    log.add({ phase: "deals", pipedriveId: "u-1", message: '"x" is not an email address, so it was not copied.' });
    log.add({ phase: "persons", pipedriveId: null, message: "Something else." });

    expect(log.groups).toEqual([
      { phase: "persons", message: '"x" is not an email address, so it was not copied.', count: 5, sampleIds: [1, 2, 3] },
      { phase: "deals", message: '"x" is not an email address, so it was not copied.', count: 1, sampleIds: ["u-1"] },
      { phase: "persons", message: "Something else.", count: 1, sampleIds: [] },
    ]);
    expect(log.dropped).toBe(0);
  });

  it("keeps exact sentences apart when asked, so two named stages are two rows", () => {
    const log = createIssueLog([]);
    log.add({ phase: "structure", pipedriveId: 1, message: 'Stage "A" was created.' }, { exact: true });
    log.add({ phase: "structure", pipedriveId: 2, message: 'Stage "B" was created.' }, { exact: true });
    expect(log.groups.map((g) => g.message)).toEqual(['Stage "A" was created.', 'Stage "B" was created.']);
  });

  it("stops at the cap and counts each refused kind once", () => {
    const log = createIssueLog([], 4);
    for (let i = 0; i < ISSUE_GROUPS_MAX; i++) log.add({ phase: "notes", pipedriveId: i, message: `Kind ${"x".repeat(i + 1)}.` });
    log.add({ phase: "notes", pipedriveId: 1, message: "One more kind." });
    log.add({ phase: "notes", pipedriveId: 2, message: "One more kind." });
    log.add({ phase: "notes", pipedriveId: 3, message: "Another kind." });
    log.add({ phase: "notes", pipedriveId: 9, message: "Kind x." });

    expect(log.groups).toHaveLength(ISSUE_GROUPS_MAX);
    expect(log.dropped).toBe(6);
    expect(log.groups[0]).toEqual({ phase: "notes", message: "Kind x.", count: 2, sampleIds: [0, 9] });
  });

  it("carries on stored groups from an earlier request", () => {
    const stored: IssueGroup[] = [{ phase: "deals", message: 'Bad "a".', count: 2, sampleIds: [1, 2] }];
    const log = createIssueLog(stored);
    log.add({ phase: "deals", pipedriveId: 3, message: 'Bad "b".' });
    expect(log.groups).toEqual([{ phase: "deals", message: 'Bad "a".', count: 3, sampleIds: [1, 2, 3] }]);
  });
});

describe("reading stored JSON", () => {
  it("reads issue groups and drops anything malformed", () => {
    expect(
      readIssueGroups([
        { phase: "deals", message: "m", count: 2, sampleIds: [1, "a", null] },
        { phase: "nope", message: "m", count: 1, sampleIds: [] },
        null,
      ]),
    ).toEqual([{ phase: "deals", message: "m", count: 2, sampleIds: [1, "a"] }]);
    expect(readIssueGroups(null)).toEqual([]);
  });

  it("reads a cursor with defaults for anything missing", () => {
    expect(readCursor(null)).toEqual({ context: { users: [], stages: {}, pipelines: {}, fields: {} }, source: 0, page: null });
    expect(readCursor({ source: 1, page: { cursor: "c9" }, context: { users: [{ id: 1 }] } })).toEqual({
      context: { users: [{ id: 1 }], stages: {}, pipelines: {}, fields: {} },
      source: 1,
      page: { cursor: "c9" },
    });
    expect(readCursor({ page: { start: 200 } }).page).toEqual({ start: 200 });
    expect(readCursor({ page: { start: -1 } }).page).toBeNull();
  });

  it("walks the steps in order and stays on done", () => {
    expect(nextPhase("users")).toBe("structure");
    expect(nextPhase("notes")).toBe("files");
    expect(nextPhase("files")).toBe("done");
    expect(nextPhase("done")).toBe("done");
  });
});
