import type { SidebarNavGroup } from "@/components/layout/sidebar";

/**
 * The Marketing sidebar group, or null for someone without Marketing access.
 * Built on the server and handed to the sidebar as plain data.
 */
export function marketingNavGroup(perms: { isAdmin: boolean; canUseMarketing: boolean }): SidebarNavGroup | null {
  if (!perms.isAdmin && !perms.canUseMarketing) return null;
  const links: SidebarNavGroup["links"] = [
    { href: "/marketing/follow-up-system", label: "Follow-up system", icon: "mail", count: 0, countLabel: "" },
  ];
  return { title: "Marketing", badge: "NEW", links };
}
