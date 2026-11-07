import { describe, expect, it } from "vitest";

import { salesDueCountWhere, salesLeadCountWhere, salesNavGroup } from "@/lib/sales/nav";
import { endOfDay } from "@/lib/utils";

// The Sales sidebar group, built on the server and handed to the shared
// sidebar as plain data, and the two counts in it: open leads beside Leads
// Inbox, and "due today or overdue" beside Activities.

const ALL_LINKS = [
  { href: "/sales/dashboard", label: "Sales dashboard", icon: "home", count: 0, countLabel: "" },
  { href: "/sales/deals", label: "Deals", icon: "board", count: 0, countLabel: "" },
  { href: "/sales/leads", label: "Leads Inbox", icon: "inbox", count: 2, countLabel: "open leads" },
  { href: "/sales/activities", label: "Activities", icon: "calendar", count: 3, countLabel: "due today or overdue" },
  { href: "/sales/contacts", label: "Contacts", icon: "people", count: 0, countLabel: "" },
  { href: "/sales/insights", label: "Insights", icon: "chart", count: 0, countLabel: "" },
  { href: "/sales/settings", label: "Sales settings", icon: "settings", count: 0, countLabel: "" },
];

describe("salesNavGroup", () => {
  it("is null for someone without Sales access (Robert O.)", () => {
    expect(salesNavGroup({ isAdmin: false, canUseSales: false }, { due: 0, leads: 0 })).toBeNull();
    expect(salesNavGroup({ isAdmin: false, canUseSales: false }, { due: 4, leads: 7 })).toBeNull();
  });

  it("gives an admin every Sales page in order", () => {
    expect(salesNavGroup({ isAdmin: true, canUseSales: false }, { due: 3, leads: 2 })).toEqual({
      title: "Sales",
      badge: "NEW",
      links: ALL_LINKS,
    });
  });

  it("gives a Sales user every page but Sales settings", () => {
    expect(salesNavGroup({ isAdmin: false, canUseSales: true }, { due: 3, leads: 2 })).toEqual({
      title: "Sales",
      badge: "NEW",
      links: ALL_LINKS.slice(0, 6),
    });
  });

  it("passes zero counts through, so the sidebar shows no pill", () => {
    const group = salesNavGroup({ isAdmin: true, canUseSales: true }, { due: 0, leads: 0 });
    expect(group?.links[2]).toEqual({
      href: "/sales/leads",
      label: "Leads Inbox",
      icon: "inbox",
      count: 0,
      countLabel: "open leads",
    });
    expect(group?.links[3]).toEqual({
      href: "/sales/activities",
      label: "Activities",
      icon: "calendar",
      count: 0,
      countLabel: "due today or overdue",
    });
  });
});

describe("salesLeadCountWhere", () => {
  it("counts the person's own open leads that are not deleted", () => {
    expect(salesLeadCountWhere("r")).toEqual({ ownerId: "r", status: "OPEN", archivedAt: null });
  });
});

describe("salesDueCountWhere", () => {
  it("counts the person's open, unarchived deal and lead activities due by the end of today (app time)", () => {
    // 11:30 PM Eastern on Nov 5 is already Nov 6 in UTC.
    expect(salesDueCountWhere("r", new Date("2026-11-06T04:30:00Z"))).toEqual({
      ownerId: "r",
      doneAt: null,
      archivedAt: null,
      dueAt: { lte: endOfDay("2026-11-05") },
      OR: [
        { dealId: { not: null }, deal: { status: "OPEN", archivedAt: null } },
        // Only while it is still on its lead: once a convert moves it to a deal, the deal decides.
        { dealId: null, leadId: { not: null }, lead: { status: "OPEN", archivedAt: null } },
      ],
    });
    expect(endOfDay("2026-11-05").toISOString()).toBe("2026-11-06T04:59:59.999Z");
  });
});
