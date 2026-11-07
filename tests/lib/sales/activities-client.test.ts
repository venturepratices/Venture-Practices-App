import { describe, expect, it } from "vitest";

import { activitiesEmptyState } from "@/lib/sales/activities-client";

// The Activities page's empty states (Decision 20): one per "when" filter, and
// one that offers to clear a type filter, each with a line of explanation and
// a way forward (spec 7.12).

describe("activitiesEmptyState", () => {
  it.each([
    ["open", { title: "Nothing to do", description: "Activities you plan on a deal or lead show up here.", action: { label: "Open Deals", href: "/sales/deals" } }],
    ["overdue", { title: "Nothing overdue", description: "You are all caught up.", action: { label: "See what is due today", href: "/sales/activities?when=today" } }],
    ["today", { title: "Nothing due today", description: "Plan your next calls from the Deals board.", action: { label: "Open Deals", href: "/sales/deals" } }],
    ["done", { title: "Nothing done yet", description: "Tick an activity's circle when it is done and it lands here.", action: { label: "See what is to do", href: "/sales/activities" } }],
  ] as const)("empty state for %s", (when, expected) => expect(activitiesEmptyState({ when, type: "all" })).toEqual(expected));

  it("offers to clear a type filter", () =>
    expect(activitiesEmptyState({ when: "open", type: "MEETING" })).toEqual({
      title: "No meeting activities here",
      description: "Other types may still have work waiting.",
      action: { label: "Show all types", href: "/sales/activities" },
    }));

  it("keeps the day filter when it clears a type filter", () =>
    expect(activitiesEmptyState({ when: "overdue", type: "LUNCH" })).toEqual({
      title: "No lunch activities here",
      description: "Other types may still have work waiting.",
      action: { label: "Show all types", href: "/sales/activities?when=overdue" },
    }));

  it("keeps Just me on links that stay on the Activities page, never on the Deals link", () => {
    expect(activitiesEmptyState({ when: "overdue", type: "all", scope: "mine" }).action.href).toBe(
      "/sales/activities?when=today&scope=mine",
    );
    expect(activitiesEmptyState({ when: "done", type: "all", scope: "mine" }).action.href).toBe("/sales/activities?scope=mine");
    expect(activitiesEmptyState({ when: "today", type: "CALL", scope: "mine" }).action.href).toBe(
      "/sales/activities?when=today&scope=mine",
    );
    expect(activitiesEmptyState({ when: "open", type: "all", scope: "mine" }).action.href).toBe("/sales/deals");
  });
});
