import { describe, expect, it } from "vitest";

import { contactsEmptyState } from "@/lib/sales/contacts-client";

// The Contacts page's pure helpers (Task 22). Wording follows Mockup v2 where
// it draws the same thing (ruling P3A-X3), else the plan's pinned strings.

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
