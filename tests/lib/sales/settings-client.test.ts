import { describe, expect, it } from "vitest";

import type { LeadAssignmentView, StageSettings } from "@/lib/sales/settings";
import {
  draftFromView,
  lostAccessBar,
  lostRotationLine,
  nobodyTickedLine,
  personLabel,
  pipelineLine,
  rottingDaysInput,
  SALES_RULES,
  settingsPatch,
  stageRottingPatch,
  stageSaveToast,
  assignmentError,
} from "@/lib/sales/settings-client";

// Pure helpers for the Sales settings screen (Task 25). Wording follows Mockup
// v2 where it draws the same thing, else the plan's pinned strings.

const members = [
  { id: "b", name: "Ben Example" },
  { id: "r", name: "Robert O." },
  { id: "d", name: "DJ" },
];

const BASE_VIEW: LeadAssignmentView = {
  mode: "ROUND_ROBIN",
  members,
  rotation: [
    { id: "b", name: "Ben Example", hasAccess: true },
    { id: "x", name: "Dana Q.", hasAccess: false },
  ],
  single: null,
  effective: { mode: "ROUND_ROBIN", names: ["Ben S."], fallbackName: null },
  firstAdminName: "Mark E.",
};

describe("settingsPatch (what a save sends)", () => {
  it("sends nothing when nothing changed", () => {
    expect(settingsPatch(draftFromView(BASE_VIEW), BASE_VIEW)).toBeNull();
  });

  it("drops people who lost access and only sends what changed", () => {
    const draft = { mode: "ROUND_ROBIN" as const, rotation: ["b", "x", "r"], single: null };
    expect(settingsPatch(draft, BASE_VIEW)).toEqual({ roundRobinMemberIds: ["b", "r"] });
  });

  it("switching to SINGLE sends the mode and the single person", () => {
    const draft = { mode: "SINGLE" as const, rotation: ["b", "x"], single: "r" };
    expect(settingsPatch(draft, BASE_VIEW)).toEqual({ leadAssignMode: "SINGLE", singleAssigneeId: "r" });
  });
});

describe("assignmentError (inline refusal)", () => {
  it("refuses a SINGLE draft with nobody picked", () => {
    const draft = { mode: "SINGLE" as const, rotation: [], single: null };
    expect(assignmentError(draft, BASE_VIEW)).toBe("Choose the person who gets every new lead.");
  });

  it("refuses a SINGLE draft naming someone without Sales access", () => {
    const draft = { mode: "SINGLE" as const, rotation: [], single: "x" };
    expect(assignmentError(draft, BASE_VIEW)).toBe(
      "The person who gets every new lead no longer has Sales access. Pick someone else.",
    );
  });

  it("accepts a valid draft", () => {
    const draft = { mode: "SINGLE" as const, rotation: [], single: "r" };
    expect(assignmentError(draft, BASE_VIEW)).toBeNull();
  });
});

describe("lostAccessBar (Decision 28: explains lost access truthfully)", () => {
  it("names who leads now go to when the saved single person lost access and a rotation covers it", () => {
    const view: LeadAssignmentView = {
      ...BASE_VIEW,
      mode: "SINGLE",
      single: { id: "b", name: "Ben Example", hasAccess: false },
      effective: { mode: "ROUND_ROBIN", names: ["Robert O."], fallbackName: null },
    };
    expect(lostAccessBar(view)).toBe(
      "Ben E. no longer has Sales access. New leads are shared out round-robin until you pick someone else.",
    );
  });

  it("names the fallback admin when nobody is on the rotation", () => {
    const view: LeadAssignmentView = {
      ...BASE_VIEW,
      mode: "SINGLE",
      single: { id: "b", name: "Ben Example", hasAccess: false },
      effective: { mode: "ROUND_ROBIN", names: [], fallbackName: "Dana E." },
    };
    expect(lostAccessBar(view)).toBe(
      "Ben E. no longer has Sales access. New leads go to Dana E. until you pick someone else.",
    );
  });

  it("says nobody can take leads when there is no fallback", () => {
    const view: LeadAssignmentView = {
      ...BASE_VIEW,
      mode: "SINGLE",
      single: { id: "b", name: "Ben Example", hasAccess: false },
      effective: { mode: "ROUND_ROBIN", names: [], fallbackName: null },
    };
    expect(lostAccessBar(view)).toBe(
      "Ben E. no longer has Sales access. Nobody can take new leads until you pick someone else.",
    );
  });

  it("uses a generic phrase for someone with no name left", () => {
    const view: LeadAssignmentView = {
      ...BASE_VIEW,
      mode: "SINGLE",
      single: { id: "gone", name: null, hasAccess: false },
      effective: { mode: "ROUND_ROBIN", names: [], fallbackName: null },
    };
    expect(lostAccessBar(view)).toBe(
      "A former team member no longer has Sales access. Nobody can take new leads until you pick someone else.",
    );
  });

  it("returns null when the single person has access, or the mode is ROUND_ROBIN", () => {
    const withAccess: LeadAssignmentView = {
      ...BASE_VIEW,
      mode: "SINGLE",
      single: { id: "b", name: "Ben Example", hasAccess: true },
    };
    expect(lostAccessBar(withAccess)).toBeNull();
    expect(lostAccessBar(BASE_VIEW)).toBeNull();
  });
});

describe("lostRotationLine (names rotation people who lost access)", () => {
  it("names one person and uses singular wording", () => {
    expect(
      lostRotationLine([{ id: "x", name: "Dana Q.", hasAccess: false }]),
    ).toBe("Dana Q. no longer has Sales access and is skipped. Saving takes Dana Q. off this list.");
  });

  it("names two people with plural wording", () => {
    expect(
      lostRotationLine([
        { id: "x", name: "Dana Q.", hasAccess: false },
        { id: "y", name: "Mark T.", hasAccess: false },
      ]),
    ).toBe("Dana Q. and Mark T. no longer have Sales access and are skipped. Saving takes them off this list.");
  });

  it("returns null when every rotation person still has access", () => {
    expect(
      lostRotationLine([
        { id: "b", name: "Ben Example", hasAccess: true },
      ]),
    ).toBeNull();
  });
});

describe("nobodyTickedLine (A8 names the first admin)", () => {
  it("names the admin", () => {
    expect(nobodyTickedLine("Mark E.")).toBe("Nobody is ticked. New leads go to Mark E. until someone is picked.");
    expect(nobodyTickedLine("DJ")).toBe("Nobody is ticked. New leads go to DJ until someone is picked.");
  });

  it("says nobody can take leads when there is no admin", () => {
    expect(nobodyTickedLine(null)).toBe("Nobody is ticked. Nobody can take new leads until someone is picked.");
  });
});

describe("personLabel (checkbox label)", () => {
  it("shortens a name", () => {
    expect(personLabel({ id: "b", name: "Ben Example", hasAccess: true })).toBe("Ben E.");
  });

  it("uses a generic phrase for someone with no name left", () => {
    expect(personLabel({ id: "gone", name: null, hasAccess: false })).toBe("A former team member");
  });
});

describe("rottingDaysInput (per-row box)", () => {
  it("accepts blank as never", () => {
    expect(rottingDaysInput("")).toEqual({ ok: true, value: null });
    expect(rottingDaysInput("  ")).toEqual({ ok: true, value: null });
  });

  it("accepts a number in range", () => {
    expect(rottingDaysInput("21")).toEqual({ ok: true, value: 21 });
    expect(rottingDaysInput("1")).toEqual({ ok: true, value: 1 });
    expect(rottingDaysInput("365")).toEqual({ ok: true, value: 365 });
  });

  it("refuses 0, 366, decimals, negatives and non-numbers", () => {
    const error = "Use a number from 1 to 365, or leave it blank.";
    for (const text of ["0", "366", "2.5", "-3", "abc"]) {
      expect(rottingDaysInput(text)).toEqual({ ok: false, error });
    }
  });
});

describe("stageRottingPatch (what the Edit stages save sends)", () => {
  const stages: StageSettings["stages"] = [
    { id: "s4", name: "Proposal Sent", probability: 75, isWon: false, isLost: false, rottingDays: 14 },
    { id: "s5", name: "Awaiting Decision", probability: 60, isWon: false, isLost: false, rottingDays: 14 },
    { id: "s7", name: "Deal Won", probability: 100, isWon: true, isLost: false, rottingDays: null },
  ];

  it("sends only stages whose number changed, and never a won or lost stage", () => {
    expect(stageRottingPatch(stages, { s4: "21", s5: "14" })).toEqual({ ok: true, stages: [{ id: "s4", rottingDays: 21 }] });
  });

  it("refuses a bad number with a per-row error and sends nothing", () => {
    expect(stageRottingPatch(stages, { s4: "0" })).toEqual({ ok: false, errors: { s4: "Use a number from 1 to 365, or leave it blank." } });
  });

  it("leaves won and lost stages out even if a key shows up for them", () => {
    expect(stageRottingPatch(stages, { s7: "21" })).toEqual({ ok: true, stages: [] });
  });
});

describe("stageSaveToast", () => {
  it("names how many stages changed", () => {
    expect(stageSaveToast(0)).toBe("No changes to save.");
    expect(stageSaveToast(1)).toBe("Saved. 1 stage changed.");
    expect(stageSaveToast(3)).toBe("Saved. 3 stages changed.");
  });
});

describe("pipelineLine (row under the pipeline name)", () => {
  it("names the kind and counts the stages", () => {
    const sales: StageSettings = {
      id: "p1",
      key: "direct-mail",
      name: "Direct Mail",
      kind: "SALES",
      stages: Array.from({ length: 9 }, (_, i) => ({
        id: `s${i + 1}`,
        name: `Stage ${i + 1}`,
        probability: 10,
        isWon: false,
        isLost: false,
        rottingDays: 14,
      })),
    };
    expect(pipelineLine(sales)).toBe("Sales · 9 stages");

    const consulting: StageSettings = {
      id: "p2",
      key: "mas",
      name: "Marketing Agency Services",
      kind: "CONSULTING",
      stages: Array.from({ length: 6 }, (_, i) => ({
        id: `cs${i + 1}`,
        name: `Stage ${i + 1}`,
        probability: 10,
        isWon: false,
        isLost: false,
        rottingDays: 14,
      })),
    };
    expect(pipelineLine(consulting)).toBe("Consulting · 6 stages");
  });
});

describe("SALES_RULES (the eight mockup lines)", () => {
  it("has the eight pinned lines in order and none contains an em dash", () => {
    expect(SALES_RULES).toEqual([
      'Every open deal and lead needs a next activity. If it has none, it shows a "No next step" badge.',
      "A deal cannot go to Proposal Sent with a $0 value.",
      "At Proposal Sent, both total value and monthly value are required.",
      "Every deal and lead has an owner.",
      "A territory hold check is added 7 days before the hold ends.",
      "Moving a deal to No Show adds a reschedule call for today.",
      "The history log cannot be edited or deleted, by anyone.",
      "Files are for final versions only (signed contracts, final proposals).",
    ]);
    for (const line of SALES_RULES) expect(line).not.toContain("—");
  });
});
