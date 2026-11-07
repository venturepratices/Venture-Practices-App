import { describe, expect, it } from "vitest";

import type { AssignmentSummary } from "@/lib/sales/lead-assignment";
import type { LeadRow } from "@/lib/sales/leads-page";
import {
  assignChoices,
  assignmentLine,
  assignMenuLabel,
  assignNote,
  autoOwnerLine,
  bulkFailureLine,
  bulkLimitNote,
  bulkToast,
  deleteLeadsCopy,
  inboxFooterLine,
  isOldLead,
  leadAgeDays,
  leadsEmptyState,
  leadSubLine,
  NEW_LEAD_HREF,
  newLeadToast,
  pruneSelection,
  selectionState,
} from "@/lib/sales/leads-client";

// The Leads Inbox's pure helpers (Task 20). Wording follows Mockup v2 where it
// draws the same thing (ruling P3A-X3), else the plan's pinned strings.

const NOW = new Date("2026-11-05T15:00:00.000Z");

const ROUND_ROBIN: AssignmentSummary = { mode: "ROUND_ROBIN", names: ["Ben S.", "Robert O."], fallbackName: null };

describe("assignmentLine", () => {
  it("names who gets new leads with one period", () => {
    const lines = [
      assignmentLine(ROUND_ROBIN, true),
      assignmentLine({ mode: "ROUND_ROBIN", names: ["Ben S.", "Dana Q.", "Robert O."], fallbackName: null }, true),
      assignmentLine(ROUND_ROBIN, false),
      assignmentLine({ mode: "SINGLE", names: ["Ben S."], fallbackName: null }, true),
      assignmentLine({ mode: "SINGLE", names: ["DJ"], fallbackName: null }, true),
      assignmentLine({ mode: "ROUND_ROBIN", names: ["Robert O."], fallbackName: null }, false),
      assignmentLine({ mode: "ROUND_ROBIN", names: [], fallbackName: "Dana E." }, true),
      assignmentLine({ mode: "ROUND_ROBIN", names: [], fallbackName: null }, false),
      assignmentLine({ mode: "ROUND_ROBIN", names: [], fallbackName: null }, true),
    ];
    expect(lines).toEqual([
      "New leads are shared out round-robin between Ben S. and Robert O. Change it in Sales settings.",
      "New leads are shared out round-robin between Ben S., Dana Q. and Robert O. Change it in Sales settings.",
      "New leads are shared out round-robin between Ben S. and Robert O.",
      "New leads all go to Ben S. Change it in Sales settings.",
      "New leads all go to DJ. Change it in Sales settings.",
      "New leads all go to Robert O.",
      "New leads go to Dana E. until someone is picked. Change it in Sales settings.",
      "Nobody can take new leads yet.",
      "Nobody can take new leads yet. Change it in Sales settings.",
    ]);
    for (const line of lines) expect(line).not.toContain("..");
  });

  it("tells someone who is not an admin who can change it (the Inbox footer)", () => {
    expect(inboxFooterLine(ROUND_ROBIN, true)).toBe(assignmentLine(ROUND_ROBIN, true));
    expect(inboxFooterLine(ROUND_ROBIN, false)).toBe(
      "New leads are shared out round-robin between Ben S. and Robert O. An admin can change this in Sales settings.",
    );
    expect(inboxFooterLine({ mode: "SINGLE", names: ["Robert O."], fallbackName: null }, false)).toBe(
      "New leads all go to Robert O. An admin can change this in Sales settings.",
    );
  });

  it("explains the automatic owner in the Add lead dialog", () => {
    expect(autoOwnerLine(ROUND_ROBIN)).toBe("Uses the rule in Sales settings: round-robin between Ben S. and Robert O.");
    expect(autoOwnerLine({ mode: "SINGLE", names: ["Ben S."], fallbackName: null })).toBe("Uses the rule in Sales settings: always Ben S.");
    expect(autoOwnerLine({ mode: "ROUND_ROBIN", names: ["DJ"], fallbackName: null })).toBe("Uses the rule in Sales settings: always DJ.");
    expect(autoOwnerLine({ mode: "ROUND_ROBIN", names: [], fallbackName: "Dana E." })).toBe(
      "Uses the rule in Sales settings: Dana E. for now.",
    );
    expect(autoOwnerLine({ mode: "ROUND_ROBIN", names: [], fallbackName: null })).toBe("Uses the rule in Sales settings.");
  });
});

describe("lead age", () => {
  it("ages leads in Eastern days", () => {
    expect(leadAgeDays("2026-11-02T15:00:00.000Z", NOW)).toBe(3);
    // 10:30 PM Eastern on Nov 4 is already Nov 5 in UTC: still one day old.
    expect(leadAgeDays("2026-11-05T03:30:00.000Z", NOW)).toBe(1);
    expect(leadAgeDays("2026-11-05T14:00:00.000Z", NOW)).toBe(0);
    expect(isOldLead(3)).toBe(true);
    expect(isOldLead(2)).toBe(false);
  });
});

describe("selection", () => {
  it("ticks loaded rows only", () => {
    expect(selectionState(new Set(), ["l1", "l2"])).toBe("none");
    expect(selectionState(new Set(["l1"]), ["l1", "l2"])).toBe("some");
    expect(selectionState(new Set(["l1", "l2"]), ["l1", "l2"])).toBe("all");
    expect(selectionState(new Set(["l1", "l9"]), ["l1", "l2"])).toBe("some");
    expect(selectionState(new Set(["l1"]), [])).toBe("none");
    expect(selectionState(new Set(), [])).toBe("none");
    expect([...pruneSelection(new Set(["l1", "l9"]), ["l1", "l2"])]).toEqual(["l1"]);
  });
});

describe("leadsEmptyState", () => {
  const defaults = { scope: "everyone", q: "", cursor: null } as const;

  it("explains an empty Inbox", () => {
    expect(leadsEmptyState(defaults, true)).toEqual({
      title: "Inbox zero.",
      description: "New Check Availability opt-ins will show up here. Add one by hand if a lead calls in.",
      action: { label: "Add a lead", href: "/sales/leads?new=1" },
    });
    expect(NEW_LEAD_HREF).toBe("/sales/leads?new=1");
    expect(leadsEmptyState({ ...defaults, q: "oak" }, true)).toEqual({
      title: 'No leads match "oak".',
      description: null,
      action: { label: "Clear search", href: "/sales/leads" },
    });
    expect(leadsEmptyState({ ...defaults, scope: "mine" }, true)).toEqual({
      title: "No leads of yours right now.",
      description: "New leads that come to you will show up here.",
      action: { label: "Show everyone's leads", href: "/sales/leads" },
    });
  });

  it("keeps Just me when clearing the search", () => {
    expect(leadsEmptyState({ scope: "mine", q: "oak", cursor: null }, true).action).toEqual({
      label: "Clear search",
      href: "/sales/leads?scope=mine",
    });
  });

  it("offers no switch to someone who sees only their own leads", () => {
    const own = {
      title: "No leads of yours right now.",
      description: "New leads that come to you will show up here.",
      action: null,
    };
    expect(leadsEmptyState(defaults, false)).toEqual(own);
    expect(leadsEmptyState({ ...defaults, scope: "mine" }, false)).toEqual(own);
  });
});

describe("bulk wording", () => {
  it("words bulk results", () => {
    expect(bulkToast("assign", 1, "Robert O.")).toBe("1 lead assigned to Robert O.");
    expect(bulkToast("assign", 3, "Robert O.")).toBe("3 leads assigned to Robert O.");
    expect(bulkToast("assign", 1, "DJ")).toBe("1 lead assigned to DJ.");
    expect(bulkToast("archive", 1)).toBe("1 lead archived.");
    expect(bulkToast("archive", 2)).toBe("2 leads archived.");
    expect(bulkToast("restore", 1)).toBe("1 lead restored.");
    expect(bulkToast("restore", 2)).toBe("2 leads restored.");
    expect(bulkToast("delete", 1)).toBe("1 lead deleted.");
    expect(bulkToast("delete", 4)).toBe("4 leads deleted.");
  });

  it("says how many could not be changed, and why", () => {
    const refused = "Only the lead owner or an admin can change this lead.";
    expect(bulkFailureLine([{ id: "l1", ok: true }, { id: "l2", ok: false, error: refused }])).toBe(
      `1 of 2 could not be changed. ${refused}`,
    );
    expect(
      bulkFailureLine([
        { id: "l1", ok: false, error: "This lead was already converted." },
        { id: "l2", ok: true },
        { id: "l3", ok: false, error: refused },
      ]),
    ).toBe("2 of 3 could not be changed. This lead was already converted.");
    expect(bulkFailureLine([{ id: "l1", ok: true }, { id: "l2", ok: true }])).toBeNull();
    expect(bulkFailureLine([])).toBeNull();
  });

  it("warns past the bulk limits", () => {
    expect(bulkLimitNote(25, true)).toBeNull();
    expect(bulkLimitNote(26, true)).toBe("Convert works on up to 25 leads at a time. Untick some to convert them.");
    expect(bulkLimitNote(26, false)).toBeNull();
    expect(bulkLimitNote(100, true)).toBe("Convert works on up to 25 leads at a time. Untick some to convert them.");
    expect(bulkLimitNote(101, true)).toBe("Pick 100 leads or fewer at a time. Untick some to go on.");
    expect(bulkLimitNote(101, false)).toBe("Pick 100 leads or fewer at a time. Untick some to go on.");
  });

  it("words the delete confirm", () => {
    expect(deleteLeadsCopy(["Crestview Dental"])).toEqual({
      title: "Delete this lead?",
      names: "Crestview Dental",
      text: "It leaves the Leads Inbox for good. The history keeps a record. This cannot be undone.",
      confirm: "Delete lead",
    });
    expect(deleteLeadsCopy(["Crestview Dental", "Maple Grove Dental"])).toEqual({
      title: "Delete 2 leads?",
      names: "Crestview Dental, Maple Grove Dental",
      text: "They leave the Leads Inbox for good. The history keeps a record. This cannot be undone.",
      confirm: "Delete 2 leads",
    });
    expect(deleteLeadsCopy(["A1", "A2", "A3", "A4", "A5", "A6", "A7"]).names).toBe("A1, A2, A3, A4, A5 and 2 more");
  });

  it("says who a new lead went to when it went to someone else", () => {
    expect(newLeadToast(null)).toBe("Lead added with its first activity.");
    expect(newLeadToast("Robert O.")).toBe("Lead added with its first activity. It went to Robert O.");
    expect(newLeadToast("DJ")).toBe("Lead added with its first activity. It went to DJ.");
  });
});

describe("the assign menu", () => {
  const members = [
    { id: "u1", name: "Ben Example" },
    { id: "u2", name: "Robert Example" },
  ];

  it("labels the menu and its note", () => {
    expect(assignMenuLabel(1)).toBe("Give this lead to");
    expect(assignMenuLabel(2)).toBe("Give 2 leads to");
    expect(assignNote(0)).toBe("Their open activities move to the new owner too.");
    expect(assignNote(1)).toBe("You can only give away leads you own. 1 of these is someone else's.");
    expect(assignNote(2)).toBe("You can only give away leads you own. 2 of these are someone else's.");
  });

  it("marks the owner they already have and the viewer", () => {
    expect(assignChoices(members, ["u2", "u2"], { userId: "u1", isAdmin: true })).toEqual({
      notMine: 0,
      choices: [
        { id: "u1", label: "Ben E. (you)", ownerNow: false, disabled: false },
        { id: "u2", label: "Robert E.", ownerNow: true, disabled: true },
      ],
    });
    // Leads with two owners: nobody owns all of them yet.
    expect(assignChoices(members, ["u1", "u2"], { userId: "u1", isAdmin: true }).choices.map((choice) => choice.disabled)).toEqual([
      false,
      false,
    ]);
  });

  it("refuses someone who is not an admin when a ticked lead is not theirs", () => {
    expect(assignChoices(members, ["u1", "u2"], { userId: "u1", isAdmin: false })).toEqual({
      notMine: 1,
      choices: [
        { id: "u1", label: "Ben E. (you)", ownerNow: false, disabled: true },
        { id: "u2", label: "Robert E.", ownerNow: false, disabled: true },
      ],
    });
  });
});

describe("leadSubLine", () => {
  const row = (extra: Partial<LeadRow>): LeadRow => ({
    id: "l1",
    title: "Crestview Dental",
    source: "Check Availability form",
    createdAt: "2026-11-02T15:00:00.000Z",
    ownerId: "u1",
    personName: "Laura B.",
    organizationName: "Crestview Dental",
    zip: "78704",
    next: null,
    ...extra,
  });

  it("names a lead's person and ZIP", () => {
    expect(leadSubLine(row({}))).toBe("Laura B. · ZIP 78704");
    expect(leadSubLine(row({ zip: null }))).toBe("Laura B.");
    expect(leadSubLine(row({ personName: null }))).toBe("ZIP 78704");
    expect(leadSubLine(row({ personName: null, zip: null }))).toBeNull();
  });

  it("says what a lead is missing", () => {
    // Named after the person when there is no practice: the person is not repeated.
    expect(leadSubLine(row({ title: "Laura B.", organizationName: null }))).toBe("ZIP 78704 · No organization yet");
    expect(leadSubLine(row({ title: "Crestview Dental", personName: null, organizationName: null, zip: null }))).toBe(
      "No person or organization yet",
    );
  });
});
