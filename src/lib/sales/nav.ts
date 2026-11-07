import type { SidebarNavGroup } from "@/components/layout/sidebar";
import type { Prisma } from "@/generated/prisma/client";
import { dateInputValue, endOfDay } from "@/lib/utils";

// The Sales group in the sidebar. Built here, on the server, and imported only
// by the app layout: the shared sidebar every signed-in person downloads
// (Robert included) holds no Sales word, path or label, and receives this
// group as plain data only when its viewer has Sales access. For everyone
// else the layout passes null, so their page carries no Sales text at all.

/** The Sales sidebar group, or null for someone without Sales access. */
export function salesNavGroup(
  perms: { isAdmin: boolean; canUseSales: boolean },
  dueCount: number,
): SidebarNavGroup | null {
  if (!perms.isAdmin && !perms.canUseSales) return null;
  return {
    title: "Sales",
    badge: "NEW",
    links: [
      { href: "/sales/deals", label: "Deals", icon: "board", count: 0 },
      { href: "/sales/activities", label: "Activities", icon: "calendar", count: dueCount },
    ],
  };
}

/**
 * The count beside Activities: this person's own to-dos that are due today or
 * overdue (app time), not done, not removed, on open deals or open leads that
 * still exist. An activity counts through its lead only while it has no deal:
 * once a convert moves it to a deal, only that deal decides. Uses the
 * (ownerId, doneAt, dueAt) index.
 */
export function salesDueCountWhere(userId: string, now: Date): Prisma.SalesActivityWhereInput {
  return {
    ownerId: userId,
    doneAt: null,
    archivedAt: null,
    dueAt: { lte: endOfDay(dateInputValue(now)) },
    OR: [
      { dealId: { not: null }, deal: { status: "OPEN", archivedAt: null } },
      { dealId: null, leadId: { not: null }, lead: { status: "OPEN", archivedAt: null } },
    ],
  };
}
