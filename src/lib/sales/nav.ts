import type { SidebarNavGroup } from "@/components/layout/sidebar";
import type { Prisma } from "@/generated/prisma/client";
import { dateInputValue, endOfDay } from "@/lib/utils";

// The Sales group in the sidebar. Built here, on the server, and imported only
// by the app layout: the shared sidebar every signed-in person downloads
// (Robert included) holds no Sales word, path or label, and receives this
// group as plain data only when its viewer has Sales access. For everyone
// else the layout passes null, so their page carries no Sales text at all.

/**
 * The Sales sidebar group, or null for someone without Sales access. Every
 * Sales page in order (R28); Sales settings for admins only. Each count brings
 * its own screen-reader words, so the shared sidebar names none of them.
 */
export function salesNavGroup(
  perms: { isAdmin: boolean; canUseSales: boolean },
  counts: { due: number; leads: number },
): SidebarNavGroup | null {
  if (!perms.isAdmin && !perms.canUseSales) return null;
  const links: SidebarNavGroup["links"] = [
    { href: "/sales/dashboard", label: "Sales dashboard", icon: "home", count: 0, countLabel: "" },
    { href: "/sales/deals", label: "Deals", icon: "board", count: 0, countLabel: "" },
    { href: "/sales/leads", label: "Leads Inbox", icon: "inbox", count: counts.leads, countLabel: "open leads" },
    {
      href: "/sales/activities",
      label: "Activities",
      icon: "calendar",
      count: counts.due,
      countLabel: "due today or overdue",
    },
    { href: "/sales/contacts", label: "Contacts", icon: "people", count: 0, countLabel: "" },
    { href: "/sales/insights", label: "Insights", icon: "chart", count: 0, countLabel: "" },
  ];
  if (perms.isAdmin) {
    links.push({ href: "/sales/settings", label: "Sales settings", icon: "settings", count: 0, countLabel: "" });
  }
  return { title: "Sales", badge: "NEW", links };
}

/**
 * The count beside Leads Inbox (R11): this person's own open leads that are
 * not deleted. Archived and converted leads have left the Inbox, so they do
 * not count. Uses the (ownerId, status, createdAt) lead index.
 */
export function salesLeadCountWhere(userId: string): Prisma.SalesLeadWhereInput {
  return { ownerId: userId, status: "OPEN", archivedAt: null };
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
