import { describe, expect, it } from "vitest";

import {
  convertButtonLabel,
  convertTargetsState,
  convertTitle,
  convertToast,
  leadCameIn,
  leadNotice,
  leadReadOnlyLine,
  lockNotes,
  moveLine,
  pricedStagesNote,
  skippedLine,
  stagePriceLine,
  takenLine,
  usableTargets,
  whyLine,
} from "@/lib/sales/convert-client";
import type { ConvertTarget } from "@/lib/sales/lead-convert";
import type { LeadPanelData } from "@/lib/sales/lead-panel";
import type { TimelineEntry } from "@/lib/sales/timeline";

// The lead panel's and the convert dialogs' words and states (Mockup v2
// `#s=lead-open`, `#s=lead-converted`, `#s=lead-convert`,
// `#s=leads-bulk-convert`, `#s=lead-convert-taken`). Pure, so every string the
// screens show is pinned here. Copy follows Mockup v2 where it words a plan
// string differently (controller ruling P3A-X3).

const NOW = new Date("2026-11-05T15:00:00.000Z");

function panel(extra: Partial<LeadPanelData> = {}, lead: Partial<LeadPanelData["lead"]> = {}): LeadPanelData {
  return {
    lead: {
      id: "l1",
      title: "Crestview Dental",
      status: "OPEN",
      source: "Check Availability form",
      createdAt: "2026-11-02T15:00:00.000Z",
      owner: { id: "b", name: "Ben S." },
      organization: { id: "o1", name: "Crestview Dental" },
      person: { id: "p1", name: "Laura B." },
      ...lead,
    },
    convertedDeal: null,
    openActivities: [],
    fields: [],
    members: [{ id: "b", name: "Ben S." }],
    canEdit: true,
    canRestore: false,
    ...extra,
  };
}

const CALL = {
  id: "a1",
  type: "CALL" as const,
  subject: "First call",
  dueAt: "2026-11-05T15:00:00.000Z",
  hasTime: false,
  createdBy: "b",
  ownerId: "b",
};

function target(id: string, stages: ConvertTarget["stages"]): ConvertTarget {
  return { id, key: id, name: id === "p1" ? "Direct Mail" : "Consulting", stages };
}

const NEW_LEAD = { id: "s1", name: "New Lead", requiresValue: false };
const PROPOSAL = { id: "s4", name: "Proposal Sent", requiresValue: true };

describe("convert dialog titles, lines and toasts", () => {
  it("names one lead or several (Mockup v2 titles)", () => {
    expect(convertTitle(1)).toBe("Convert to deal");
    expect(convertTitle(3)).toBe("Convert leads to deals");
  });

  it("lists the leads under the bulk title, five at most", () => {
    expect(whyLine(["Crestview Dental", "Oak Creek"])).toBe("Crestview Dental, Oak Creek");
    expect(whyLine(["A", "B", "C", "D", "E", "F", "G"])).toBe("A, B, C, D, E and 2 more");
  });

  it("says where the new deals went", () => {
    expect(convertToast(1, "Direct Mail")).toBe("Lead converted. Find it in Direct Mail.");
    expect(convertToast(3, "Direct Mail")).toBe("3 leads converted. Find them in Direct Mail.");
    expect(convertToast(1, "Dr. Lee K.")).toBe("Lead converted. Find it in Dr. Lee K.");
  });

  it("names the leads a bulk convert skips, and that they stay in the inbox", () => {
    expect(skippedLine(["Crestview Dental", "Oak Creek"])).toBe(
      "Add a person or an organization first: Crestview Dental, Oak Creek. They stay in the inbox.",
    );
    expect(skippedLine(["Dr. Lee K."])).toBe("Add a person or an organization first: Dr. Lee K. It stays in the inbox.");
    expect(skippedLine([])).toBeNull();
  });

  it("labels the button by what it converts", () => {
    expect(convertButtonLabel(1, true)).toBe("Convert");
    expect(convertButtonLabel(1, false)).toBe("Convert 1 lead");
    expect(convertButtonLabel(3, false)).toBe("Convert 3 leads");
  });

  it("says what moves to the deal (single convert)", () => {
    expect(moveLine([], NOW)).toBe("It has no next step, so a first call is added for today. Notes move to the deal.");
    expect(moveLine([{ subject: "First call", dueAt: CALL.dueAt }], NOW)).toBe(
      "Its next step moves to the deal: First call (today). Notes move too.",
    );
    expect(moveLine([{ subject: "Demo", dueAt: "2026-11-06T15:00:00.000Z" }], NOW)).toBe(
      "Its next step moves to the deal: Demo (tomorrow). Notes move too.",
    );
    expect(moveLine([{ subject: "Old call", dueAt: "2026-11-02T15:00:00.000Z" }], NOW)).toBe(
      "Its next step moves to the deal: Old call (Nov 2). Notes move too.",
    );
    expect(
      moveLine(
        [
          { subject: "First call", dueAt: CALL.dueAt },
          { subject: "Demo", dueAt: "2026-11-06T15:00:00.000Z" },
        ],
        NOW,
      ),
    ).toBe("Its 2 open activities move to the deal. Notes move too.");
  });

  it("asks for both values in a stage that needs a price, naming the stage", () => {
    expect(stagePriceLine("Proposal Sent")).toBe("Proposal Sent needs a real price, so both values are required.");
  });

  it("explains why priced stages are missing from bulk convert", () => {
    expect(pricedStagesNote(["Proposal Sent"])).toBe(
      "Stages that need a price (Proposal Sent) are not offered here. Convert one lead at a time for those.",
    );
    expect(pricedStagesNote(["Proposal Sent", "Contract Sent"])).toBe(
      "Stages that need a price (Proposal Sent and Contract Sent) are not offered here. Convert one lead at a time for those.",
    );
    expect(pricedStagesNote([])).toBeNull();
  });

  it("says which deal a lead already became (409)", () => {
    expect(takenLine("Oak Creek Dental", "Direct Mail")).toBe(
      "It is the deal Oak Creek Dental in Direct Mail now. Nothing was changed just now.",
    );
    expect(takenLine("Oak Creek Dental", null)).toBe("It is the deal Oak Creek Dental now. Nothing was changed just now.");
  });
});

describe("the convert dialog explains its pipelines list", () => {
  it("loading, error, nothing to pick, and ready", () => {
    expect(convertTargetsState("loading")).toEqual({ kind: "loading", text: "Loading pipelines…" });
    expect(convertTargetsState("error")).toEqual({ kind: "error", text: "Could not load pipelines.", action: "Try again" });
    expect(convertTargetsState({ targets: [] })).toEqual({
      kind: "empty",
      text: "No sales pipelines yet. Ask an admin to run the Sales setup.",
    });
    expect(convertTargetsState({ targets: [target("p1", [NEW_LEAD])] })).toEqual({ kind: "ready" });
  });

  it("treats pipelines with no stage to land on like no pipelines (Task 8 note)", () => {
    expect(convertTargetsState({ targets: [target("p1", [])] })).toEqual({
      kind: "empty",
      text: "No sales pipelines yet. Ask an admin to run the Sales setup.",
    });
  });

  it("offers bulk convert no stage that needs a price, and drops pipelines left empty", () => {
    const targets = [target("p1", [NEW_LEAD, PROPOSAL]), target("p2", [PROPOSAL])];
    expect(usableTargets(targets, false)).toEqual(targets);
    expect(usableTargets(targets, true)).toEqual([target("p1", [NEW_LEAD])]);
    expect(usableTargets([target("p1", [])], false)).toEqual([]);
  });
});

describe("the lead panel's notice bar", () => {
  it("points a converted lead at its deal, or says it cannot be opened", () => {
    expect(leadNotice(panel({ convertedDeal: { id: "d7", title: "Oak Creek Dental" }, canEdit: false }, { status: "CONVERTED" }))).toEqual({
      tone: "info",
      text: "Converted to Oak Creek Dental. Its activities and notes are on the deal now.",
      action: "open-deal",
    });
    expect(leadNotice(panel({ convertedDeal: { id: "d7", title: "Dr. Lee K." }, canEdit: false }, { status: "CONVERTED" }))?.text).toBe(
      "Converted to Dr. Lee K. Its activities and notes are on the deal now.",
    );
    expect(leadNotice(panel({ convertedDeal: null, canEdit: false }, { status: "CONVERTED" }))).toEqual({
      tone: "info",
      text: "Converted to a deal you cannot open.",
      action: null,
    });
  });

  it("offers Restore on an archived lead only to its owner or an admin", () => {
    expect(leadNotice(panel({ canEdit: false, canRestore: true }, { status: "ARCHIVED" }))).toEqual({
      tone: "info",
      text: "This lead is archived.",
      action: "restore",
    });
    expect(leadNotice(panel({ canEdit: false, canRestore: false }, { status: "ARCHIVED" }))).toEqual({
      tone: "info",
      text: "This lead is archived.",
      action: null,
    });
  });

  it("warns an open lead with no next step, with Schedule for whoever may add one", () => {
    expect(leadNotice(panel())).toEqual({
      tone: "warning",
      text: "No next step. Call within 5 minutes of opt-in works best.",
      action: "schedule",
    });
    // Mockup v2 `#s=lead-open&id=1&as=rep`: the bar still shows, without Schedule.
    expect(leadNotice(panel({ canEdit: false }))).toEqual({
      tone: "warning",
      text: "No next step. Call within 5 minutes of opt-in works best.",
      action: null,
    });
    expect(leadNotice(panel({ openActivities: [CALL] }))).toBeNull();
  });

  it("names who may change a lead the viewer cannot (Mockup v2 lock line)", () => {
    expect(leadReadOnlyLine("Ben S.")).toBe("Ben S. owns this lead. Only they or an admin can change it.");
  });

  it("says when an open lead came in", () => {
    expect(leadCameIn("2026-11-05T13:00:00.000Z", NOW)).toBe("Open lead · came in today");
    expect(leadCameIn("2026-11-04T13:00:00.000Z", NOW)).toBe("Open lead · came in yesterday");
    expect(leadCameIn("2026-11-02T15:00:00.000Z", NOW)).toBe("Open lead · came in Nov 2");
    // 11:30 PM Eastern on Nov 4 is Nov 5 in UTC: still yesterday in app time.
    expect(leadCameIn("2026-11-05T04:30:00.000Z", NOW)).toBe("Open lead · came in yesterday");
  });
});

describe("notes on a lead that is not open", () => {
  const entries: TimelineEntry[] = [
    {
      id: "h1",
      at: "2026-11-05T14:00:00.000Z",
      actorType: "USER",
      actorName: "Ben S.",
      icon: "note",
      text: "Note added",
      note: { id: "n1", body: "Called twice.", canEdit: true },
    },
    { id: "h2", at: "2026-11-05T13:00:00.000Z", actorType: "USER", actorName: "Ben S.", icon: "created", text: "Lead created" },
  ];

  it("offer no Edit once the lead is converted or archived (the server refuses it, Task 6)", () => {
    expect(lockNotes(entries, "OPEN")).toBe(entries);
    const locked = lockNotes(entries, "CONVERTED");
    expect(locked[0].note).toEqual({ id: "n1", body: "Called twice.", canEdit: false });
    expect(locked[1]).toBe(entries[1]);
    expect(lockNotes(entries, "ARCHIVED")[0].note?.canEdit).toBe(false);
  });
});
