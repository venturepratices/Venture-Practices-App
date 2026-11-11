import { describe, expect, it } from "vitest";

import {
  contactMetaCount,
  contactsEmptyState,
  duplicateNotice,
  listCapLine,
  mergeConfirmLine,
  mergeCountsLine,
  mergedToast,
  mergeFillLine,
} from "@/lib/sales/contacts-client";

// The Contacts page's pure helpers (Task 22) and the contact panel's pure
// helpers (Task 23). Wording follows Mockup v2 where it draws the same thing
// (ruling P3A-X3), else the plan's pinned strings.

describe("contactsEmptyState", () => {
  const defaults = { tab: "people", scope: "everyone", q: "", cursor: null } as const;

  it("explains an empty Contacts tab", () => {
    expect(contactsEmptyState(defaults)).toEqual({
      title: "No people yet.",
      description: "People are added with each deal and lead, or here by hand.",
      action: { label: "Person", href: "/sales/contacts?new=person" },
    });
    expect(contactsEmptyState({ ...defaults, tab: "organizations" })).toEqual({
      title: "No organizations yet.",
      description: "Practices are added with each deal and lead, or here by hand.",
      action: { label: "Organization", href: "/sales/contacts?tab=organizations&new=organization" },
    });
  });

  it("explains a search that found nothing", () => {
    expect(contactsEmptyState({ ...defaults, q: "oak" })).toEqual({
      title: 'No people match "oak".',
      description: null,
      action: { label: "Clear search", href: "/sales/contacts" },
    });
    expect(contactsEmptyState({ tab: "organizations", scope: "mine", q: "oak", cursor: null })).toEqual({
      title: 'No organizations match "oak".',
      description: null,
      action: { label: "Clear search", href: "/sales/contacts?tab=organizations&scope=mine" },
    });
  });

  it("explains Just me with nothing to show", () => {
    expect(contactsEmptyState({ ...defaults, scope: "mine" })).toEqual({
      title: "No people of yours yet.",
      description: "People you own show up here.",
      action: { label: "Show everyone's", href: "/sales/contacts" },
    });
    expect(contactsEmptyState({ tab: "organizations", scope: "mine", q: "", cursor: null })).toEqual({
      title: "No organizations of yours yet.",
      description: "Organizations you own show up here.",
      action: { label: "Show everyone's", href: "/sales/contacts?tab=organizations" },
    });
  });
});

describe("names possible duplicates", () => {
  it("has nothing to say when there is no match and nothing hidden", () => {
    expect(duplicateNotice({ matches: [], hiddenMatch: false }, true)).toBeNull();
  });

  it("names a hidden match without showing it, and leaves Merge off", () => {
    expect(duplicateNotice({ matches: [], hiddenMatch: true }, false)).toEqual({
      kind: "hidden",
      text: "A matching contact already exists. Ask an admin to merge.",
    });
  });

  it("shows one visible match, singular label, no tail for admins", () => {
    expect(
      duplicateNotice({ matches: [{ id: "p2", name: "Sarah Example" }], hiddenMatch: true }, true),
    ).toEqual({
      kind: "matches",
      label: "Possible duplicate:",
      matches: [{ id: "p2", name: "Sarah Example" }],
      tail: null,
    });
  });

  it("uses the plural label for more than one match and asks non-admins to ask an admin", () => {
    expect(
      duplicateNotice(
        {
          matches: [
            { id: "p2", name: "Sarah Example" },
            { id: "p3", name: "Sarah K." },
          ],
          hiddenMatch: false,
        },
        false,
      ),
    ).toEqual({
      kind: "matches",
      label: "Possible duplicates:",
      matches: [
        { id: "p2", name: "Sarah Example" },
        { id: "p3", name: "Sarah K." },
      ],
      tail: "Ask an admin to merge.",
    });
  });
});

describe("words the merge", () => {
  it("counts rows in the order people, deals, leads, activities, notes", () => {
    expect(mergeCountsLine({ people: 0, deals: 3, leads: 1, notes: 4, activities: 0 })).toBe(
      "Moves 3 deals, 1 lead and 4 notes.",
    );
    expect(mergeCountsLine({ people: 2, deals: 0, leads: 0, notes: 0, activities: 1 })).toBe(
      "Moves 2 people and 1 activity.",
    );
    expect(mergeCountsLine({ people: 1, deals: 1, leads: 0, notes: 0, activities: 2 })).toBe(
      "Moves 1 person, 1 deal and 2 activities.",
    );
    expect(mergeCountsLine({ people: 0, deals: 0, leads: 0, notes: 0, activities: 0 })).toBe(
      "Nothing else moves.",
    );
  });

  it("writes a person confirm that keeps the kept name's own period", () => {
    expect(mergeConfirmLine("person", "Sarah K.", "Sarah Example")).toBe(
      "Keep Sarah K. Merge Sarah Example into it. Deals, leads, notes and activities move to Sarah K.",
    );
  });

  it("writes an organization confirm with its own set of things that move", () => {
    expect(mergeConfirmLine("organization", "Oak Creek Dental", "Oak Creek")).toBe(
      "Keep Oak Creek Dental. Merge Oak Creek into it. Deals, leads, people and notes move to Oak Creek Dental.",
    );
  });

  it("writes the fill-blanks line without a second period on a short last name", () => {
    expect(mergeFillLine("Sarah K.", "Ben S.")).toBe(
      "Empty details on Sarah K. are filled in from Ben S. Nothing on Sarah K. is overwritten.",
    );
  });

  it("writes the merged toast", () => {
    expect(mergedToast("Sarah K.", "Sarah Example")).toBe(
      "Merged. Sarah Example is now part of Sarah K.",
    );
  });

  it("never writes two dots in a row anywhere in the merge wording", () => {
    const counts = mergeCountsLine({ people: 1, deals: 1, leads: 0, notes: 0, activities: 0 });
    const confirm = mergeConfirmLine("person", "Sarah K.", "Sarah Example");
    const fill = mergeFillLine("Sarah K.", "Ben S.");
    const toast = mergedToast("Sarah K.", "Sarah Example");
    for (const line of [counts, confirm, fill, toast]) expect(line.includes("..")).toBe(false);
  });

  it("counts people in words on the organization panel's meta", () => {
    expect(contactMetaCount(1)).toBe("1 person");
    expect(contactMetaCount(3)).toBe("3 people");
    expect(contactMetaCount(0)).toBe("0 people");
  });

  it("writes the list-cap line when more exist, nothing when not", () => {
    expect(listCapLine(20, 35)).toBe("Showing 20 of 35.");
    expect(listCapLine(5, 5)).toBeNull();
    expect(listCapLine(3, 2)).toBeNull();
  });
});
