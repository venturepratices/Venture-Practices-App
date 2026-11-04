import { describe, expect, it } from "vitest";

import { salesDueCountWhere, salesNavGroup } from "@/lib/sales/nav";
import { endOfDay } from "@/lib/utils";

// The Sales sidebar group, built on the server and handed to the shared
// sidebar as plain data, and the "due today or overdue" count beside Activities.

describe("salesNavGroup", () => {
  it("is null for someone without Sales access (Robert O.)", () => {
    expect(salesNavGroup({ isAdmin: false, canUseSales: false }, 0)).toBeNull();
    expect(salesNavGroup({ isAdmin: false, canUseSales: false }, 4)).toBeNull();
  });

  it.each([
    ["an admin", { isAdmin: true, canUseSales: false }],
    ["a Sales user", { isAdmin: false, canUseSales: true }],
  ])("gives %s the Deals and Activities links with the due count", (_who, perms) => {
    expect(salesNavGroup(perms, 3)).toEqual({
      title: "Sales",
      badge: "NEW",
      links: [
        { href: "/sales/deals", label: "Deals", icon: "board", count: 0 },
        { href: "/sales/activities", label: "Activities", icon: "calendar", count: 3 },
      ],
    });
  });

  it("passes a zero count through, so the sidebar shows no pill", () => {
    expect(salesNavGroup({ isAdmin: true, canUseSales: true }, 0)?.links[1]).toEqual({
      href: "/sales/activities",
      label: "Activities",
      icon: "calendar",
      count: 0,
    });
  });
});

describe("salesDueCountWhere", () => {
  it("counts the person's open, unarchived deal activities due by the end of today (app time)", () => {
    // 11:30 PM Eastern on Nov 5 is already Nov 6 in UTC.
    expect(salesDueCountWhere("r", new Date("2026-11-06T04:30:00Z"))).toEqual({
      ownerId: "r",
      doneAt: null,
      archivedAt: null,
      dueAt: { lte: endOfDay("2026-11-05") },
      deal: { status: "OPEN", archivedAt: null },
    });
    expect(endOfDay("2026-11-05").toISOString()).toBe("2026-11-06T04:59:59.999Z");
  });
});
