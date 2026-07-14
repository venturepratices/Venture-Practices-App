"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Archive, ChevronRight, LayoutDashboard, LayoutList, ListChecks, Users, Building2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMobileSidebar } from "@/components/layout/mobile-sidebar-context";

type SidebarClient = {
  id: string;
  name: string;
};

const AGENCY_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "All Clients", icon: Building2 },
  { href: "/tasks", label: "All Tasks", icon: LayoutList },
  { href: "/my-tasks", label: "My Tasks", icon: ListChecks },
  { href: "/team", label: "Team", icon: Users, adminOnly: true },
  { href: "/activity", label: "Activity", icon: Activity, activityArchive: true },
  { href: "/archive", label: "Archive", icon: Archive, activityArchive: true },
];

export function Sidebar({
  clients,
  isAdmin = false,
  canViewActivityArchive = false,
}: {
  clients: SidebarClient[];
  isAdmin?: boolean;
  canViewActivityArchive?: boolean;
}) {
  const pathname = usePathname();
  const [clientsOpen, setClientsOpen] = useState(true);
  const { isOpen, close } = useMobileSidebar();

  // Hide nav items the viewer can't use — Team is admin-only; Activity/Archive
  // need the activity-archive capability. (These are also enforced server-side;
  // hiding is just so people don't see dead links.)
  const links = AGENCY_LINKS.filter((link) => {
    if ("adminOnly" in link && link.adminOnly) return isAdmin;
    if ("activityArchive" in link && link.activityArchive) return canViewActivityArchive;
    return true;
  });

  // Auto-close the mobile drawer whenever the route changes, instead of closing
  // on the Link's own click — closing synchronously inside a Link's onClick can
  // hide the anchor (display:none) before the browser follows its href, which
  // cancels the navigation.
  useEffect(() => {
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      {isOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={close}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      ) : null}
      <aside
        className={cn(
          "z-50 h-full w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:static md:z-auto md:flex",
          isOpen ? "fixed inset-y-0 left-0 flex" : "hidden"
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary font-heading text-xs font-bold text-sidebar-primary-foreground">
            VP
          </span>
          <span className="truncate font-heading text-sm font-semibold">Venture Practices</span>
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="ml-auto rounded-md p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}

        <div className="pt-4">
          <button
            type="button"
            onClick={() => setClientsOpen((open) => !open)}
            className="flex w-full items-center gap-1 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", clientsOpen && "rotate-90")} />
            Clients
          </button>
          {clientsOpen ? (
            <div className="mt-1 space-y-1">
              {clients.length === 0 ? (
                <p className="px-3 py-1.5 text-sm text-sidebar-foreground/50">No clients yet</p>
              ) : (
                clients.map((client) => {
                  const href = `/clients/${client.id}`;
                  const active = pathname.startsWith(`/clients/${client.id}`);
                  return (
                    <Link
                      key={client.id}
                      href={href}
                      className={cn(
                        "block truncate rounded-md px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                    >
                      {client.name}
                    </Link>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
        </nav>
      </aside>
    </>
  );
}
