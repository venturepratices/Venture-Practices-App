import { describe, expect, it } from "vitest";

import { DEFAULT_ROTTING_DAYS } from "@/lib/sales/constants";
import {
  activityTarget,
  appFieldType,
  changedFields,
  convertCustomValue,
  isMidnightDueTime,
  keepGuessedValues,
  matchPipedriveUsers,
  optionLabels,
  planStages,
  resolveDealStage,
  resolveLink,
  resolveOwner,
  uniqueKey,
} from "@/lib/sales/pipedrive/import-decide";
import { emptyContext } from "@/lib/sales/pipedrive/import-state";

// The import engine's decisions, each a pure function, checked directly.

describe("matchPipedriveUsers", () => {
  const members = [
    { id: "m1", name: "Ben K", email: "ben@vp.test" },
    { id: "m2", name: "Robert S", email: "robert@vp.test" },
  ];

  it("matches by email in any case, lets a saved choice win, and leaves the rest unmatched", () => {
    const result = matchPipedriveUsers(
      [
        { id: 1, name: "Ben", email: "BEN@vp.test " },
        { id: 2, name: "Rob", email: "rob@other.test" },
        { id: 3, name: "Gone", email: null },
        { id: 4, name: "Moved", email: "ben@vp.test" },
      ],
      members,
      [
        { pipedriveUserId: 2, memberId: "m2" },
        { pipedriveUserId: 4, memberId: "not-a-sales-member" },
      ],
    );
    expect(result).toEqual([
      { pipedriveUserId: 1, name: "Ben", email: "BEN@vp.test", memberId: "m1", memberName: "Ben K", auto: true },
      { pipedriveUserId: 2, name: "Rob", email: "rob@other.test", memberId: "m2", memberName: "Robert S", auto: false },
      { pipedriveUserId: 3, name: "Gone", email: null, memberId: null, memberName: null, auto: false },
      // A saved choice of someone who cannot own Sales records is ignored, and the email match is used.
      { pipedriveUserId: 4, name: "Moved", email: "ben@vp.test", memberId: "m1", memberName: "Ben K", auto: true },
    ]);
  });

  it("names a user with no name by their id", () => {
    expect(matchPipedriveUsers([{ id: 7, name: " ", email: "" }], [], [])[0].name).toBe("Pipedrive user 7");
  });
});

describe("resolveOwner", () => {
  const owners = new Map([[1, "m1"]]);

  it("uses the matched team member", () => {
    expect(resolveOwner(1, owners, "starter", "owner")).toEqual({ memberId: "m1", issue: null });
  });

  it("falls back to the person who started the run, with an issue", () => {
    expect(resolveOwner(2, owners, "starter", "owner")).toEqual({
      memberId: "starter",
      issue: "The owner in Pipedrive matches no team member, so the person who started the import owns it.",
    });
    expect(resolveOwner(null, owners, "starter", "owner")).toEqual({
      memberId: "starter",
      issue: "The record had no owner in Pipedrive, so the person who started the import owns it.",
    });
    expect(resolveOwner(2, owners, "starter", "author")).toEqual({
      memberId: "starter",
      issue: "The author in Pipedrive matches no team member, so the person who started the import is shown as the author.",
    });
  });
});

describe("changedFields", () => {
  it("gives only the values that differ, comparing dates by time and null with undefined as equal", () => {
    const before = { a: "x", b: new Date("2026-01-01T00:00:00Z"), c: null, d: 1, e: undefined };
    const after = { a: "x", b: new Date("2026-01-01T00:00:00Z"), c: undefined, d: 2, e: "new" };
    expect(changedFields(before, after)).toEqual({ d: 2, e: "new" });
    expect(changedFields({ b: new Date(1) }, { b: new Date(2) })).toEqual({ b: new Date(2) });
    expect(changedFields({ b: new Date(1) }, { b: null })).toEqual({ b: null });
  });
});

describe("keepGuessedValues", () => {
  const fallback = new Date("2026-11-12T16:00:00Z");
  it("keeps the stored date when this run could only guess it (the import date), so a re-run does not churn", () => {
    const existing = { doneAt: new Date("2026-11-12T15:00:00Z"), dueAt: new Date("2026-01-01T00:00:00Z"), wonAt: null };
    const changed = { doneAt: fallback, dueAt: new Date("2026-02-01T00:00:00Z"), wonAt: fallback, title: "x" };
    expect(keepGuessedValues(changed, existing, fallback)).toEqual({
      dueAt: new Date("2026-02-01T00:00:00Z"),
      // Nothing was stored before, so the guess is written.
      wonAt: fallback,
      title: "x",
    });
  });
});

describe("resolveLink", () => {
  const found = new Map<number | string, string>([[5, "app5"]]);
  it("turns a Pipedrive id into the app id, drops a missing one with the issue, and leaves no link alone", () => {
    expect(resolveLink(5, found, "gone")).toEqual({ id: "app5", issue: null });
    expect(resolveLink(6, found, "gone")).toEqual({ id: null, issue: "gone" });
    expect(resolveLink(null, found, "gone")).toEqual({ id: null, issue: null });
  });
});

describe("activityTarget", () => {
  it("keeps an activity that is on a deal, lead or person", () => {
    expect(activityTarget({ dealId: "d", leadId: null, personId: null }, null)).toEqual({ personId: null, issue: null });
    expect(activityTarget({ dealId: null, leadId: null, personId: "p" }, null)).toEqual({ personId: "p", issue: null });
  });

  it("puts an organization-only activity on that organization's first person", () => {
    expect(activityTarget({ dealId: null, leadId: null, personId: null }, { firstPersonId: "p1" })).toEqual({
      personId: "p1",
      issue: "The activity was only on an organization, so it was put on that organization's first person.",
    });
  });

  it("skips an organization-only activity when the organization has no people, and one on nothing", () => {
    expect(activityTarget({ dealId: null, leadId: null, personId: null }, { firstPersonId: null })).toEqual({
      skip: "The activity was only on an organization with no people, so it was not copied.",
    });
    expect(activityTarget({ dealId: null, leadId: null, personId: null }, null)).toEqual({
      skip: "The activity was not on a deal, lead or person that was copied, so it was not copied.",
    });
  });
});

describe("resolveDealStage", () => {
  const ctx = {
    ...emptyContext(),
    stages: { "10": { stageId: "s10", pipelineId: "p1" } },
    pipelines: { "1": { pipelineId: "p1", firstStageId: "s-first" }, "2": { pipelineId: "p2", firstStageId: null } },
  };

  it("uses the matched stage, so a won deal keeps its stage", () => {
    expect(resolveDealStage(10, 1, ctx, true)).toEqual({ stageId: "s10", pipelineId: "p1", issue: null });
  });

  it("falls back to the first stage of the pipeline, with an issue", () => {
    expect(resolveDealStage(99, 1, ctx, true)).toEqual({
      stageId: "s-first",
      pipelineId: "p1",
      issue: "The deal's stage was not found in Pipedrive's stage list, so it was put in the first stage of its pipeline.",
    });
  });

  it("skips a deal with no known pipeline, or (in a real run) a pipeline with no stages", () => {
    expect(resolveDealStage(99, 3, ctx, true)).toEqual({
      skip: "The deal's stage and pipeline were not found in Pipedrive's lists, so it was not copied.",
    });
    expect(resolveDealStage(99, 2, ctx, true)).toEqual({
      skip: "The deal's pipeline has no stages in the app, so it was not copied.",
    });
    expect(resolveDealStage(99, 2, ctx, false)).toMatchObject({ pipelineId: "p2" });
  });
});

describe("planStages", () => {
  const app = [
    { id: "a1", key: "new-opt-in", name: "New Opt-In", position: 1, isWon: false, isLost: false, archivedAt: null },
    { id: "a2", key: "demo", name: "Demo", position: 2, isWon: false, isLost: false, archivedAt: null },
    { id: "a3", key: "won", name: "Won", position: 3, isWon: true, isLost: false, archivedAt: null },
    { id: "a4", key: "old", name: "Old", position: 4, isWon: false, isLost: false, archivedAt: new Date() },
  ];

  it("matches by name key and puts new stages before the won and lost stages", () => {
    const plan = planStages(app, [
      { id: 11, name: "new opt in", order_nr: 1, deal_probability: 10 },
      { id: 13, name: "Old", order_nr: 3, deal_probability: 150, is_deal_rot_enabled: true, days_to_rotten: 30 },
      { id: 12, name: "Proposal", order_nr: 2, deal_probability: 70 },
    ]);
    expect(plan.matched).toEqual({ "11": "a1" });
    expect(plan.creates).toEqual([
      { pipedriveId: 12, key: "proposal", name: "Proposal", position: 3, probability: 70, rottingDays: DEFAULT_ROTTING_DAYS },
      // An archived stage is not a match, and its key is taken, so the new one gets a suffix.
      { pipedriveId: 13, key: "old-2", name: "Old", position: 4, probability: 100, rottingDays: 30 },
    ]);
    expect(plan.shiftFrom).toBe(3);
  });

  it("adds at the end of a pipeline with no won or lost stage, with nothing to shift", () => {
    const plan = planStages([], [{ id: 1, name: " ", order_nr: 1 }]);
    expect(plan.creates).toEqual([
      { pipedriveId: 1, key: "unnamed-stage", name: "Unnamed stage", position: 1, probability: 0, rottingDays: DEFAULT_ROTTING_DAYS },
    ]);
    expect(plan.shiftFrom).toBeNull();
  });
});

describe("uniqueKey", () => {
  it("keeps a free key, suffixes a taken one, uses the fallback for an empty one, and remembers what it gave", () => {
    const taken = new Set(["budget", "budget-2"]);
    expect(uniqueKey("budget", taken, "field")).toBe("budget-3");
    expect(uniqueKey("budget", taken, "field")).toBe("budget-4");
    expect(uniqueKey("", taken, "field")).toBe("field");
    expect(uniqueKey("other", taken, "field")).toBe("other");
  });
});

describe("custom fields", () => {
  it("picks the app field type from Pipedrive's", () => {
    expect(appFieldType("double")).toBe("NUMBER");
    expect(appFieldType("monetary")).toBe("NUMBER");
    expect(appFieldType("date")).toBe("DATE");
    expect(appFieldType("enum")).toBe("SELECT");
    expect(appFieldType("set")).toBe("TEXT");
    expect(appFieldType("varchar")).toBe("TEXT");
    expect(appFieldType(undefined)).toBe("TEXT");
  });

  it("reads option labels by id", () => {
    expect(optionLabels([{ id: 1, label: "Red" }, { id: "2", label: " Blue " }, { id: 3 }, null])).toEqual({ "1": "Red", "2": "Blue" });
    expect(optionLabels(null)).toBeNull();
  });

  it("turns option ids into labels and drops an unknown id with an issue", () => {
    const field = { name: "Color", options: { "1": "Red", "2": "Blue" }, dealFieldId: "f", leadFieldId: null };
    expect(convertCustomValue("1", field)).toEqual({ value: "Red", issue: null });
    expect(convertCustomValue("1, 2", field)).toEqual({ value: "Red, Blue", issue: null });
    expect(convertCustomValue("2,9", field)).toEqual({
      value: "Blue",
      issue: 'A choice in the Pipedrive field "Color" no longer exists in Pipedrive, so it was not copied.',
    });
    expect(convertCustomValue("9", field)).toMatchObject({ value: null });
    expect(convertCustomValue("free text", { ...field, options: null })).toEqual({ value: "free text", issue: null });
  });
});

describe("isMidnightDueTime", () => {
  it("is true only for exactly 00:00 or 00:00:00", () => {
    expect(isMidnightDueTime("00:00")).toBe(true);
    expect(isMidnightDueTime("00:00:00")).toBe(true);
    expect(isMidnightDueTime(" 00:00 ")).toBe(true);
    expect(isMidnightDueTime("00:01")).toBe(false);
    expect(isMidnightDueTime("")).toBe(false);
    expect(isMidnightDueTime(null)).toBe(false);
  });
});
