"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Same tab-strip pattern as SubAccountNav (the Info/Tasks/Projects tabs on a
// client page) — "Private" is just another tab here, not a sidebar entry, so
// My Tasks and its private-only view share one place in the nav.
const LINKS = [
  { href: "/my-tasks", label: "Tasks" },
  { href: "/my-tasks/private", label: "Private" },
];

export function MyTasksTabNav() {
  const pathname = usePathname();

  return (
    <div className="relative border-b">
      <nav className="flex gap-1 overflow-x-auto px-4 md:px-6">
        {LINKS.map(({ href, label }) => {
          const active = href === "/my-tasks" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent md:hidden" />
    </div>
  );
}
