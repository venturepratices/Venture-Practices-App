"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Activity, Archive, ChevronRight, LayoutDashboard, LayoutList, ListChecks, Users, Building2 } from "lucide-react";

import { cn } from "@/lib/utils";

type SidebarClient = {
  id: string;
  name: string;
};

const AGENCY_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "All Clients", icon: Building2 },
  { href: "/tasks", label: "All Tasks", icon: LayoutList },
  { href: "/my-tasks", label: "My Tasks", icon: ListChecks },
  { href: "/team", label: "Team", icon: Users },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/archive", label: "Archive", icon: Archive },
];

export function Sidebar({ clients }: { clients: SidebarClient[] }) {
  const pathname = usePathname();
  const [clientsOpen, setClientsOpen] = useState(true);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex h-14 items-center border-b px-4">
        <span className="font-semibold">Venture Practices</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {AGENCY_LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
            className="flex w-full items-center gap-1 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", clientsOpen && "rotate-90")} />
            Clients
          </button>
          {clientsOpen ? (
            <div className="mt-1 space-y-1">
              {clients.length === 0 ? (
                <p className="px-3 py-1.5 text-sm text-muted-foreground">No clients yet</p>
              ) : (
                clients.map((client) => {
                  const href = `/clients/${client.id}/tasks`;
                  const active = pathname.startsWith(`/clients/${client.id}`);
                  return (
                    <Link
                      key={client.id}
                      href={href}
                      className={cn(
                        "block truncate rounded-md px-3 py-1.5 text-sm transition-colors",
                        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
  );
}
