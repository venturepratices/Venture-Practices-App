"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/portal", label: "My Assets" },
  { href: "/portal/campaigns", label: "My Campaigns" },
  { href: "/portal/workflows", label: "My Projects" },
  { href: "/portal/intake", label: "Business Info" },
];

export function PortalNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b px-6">
      {LINKS.map(({ href, label }) => {
        const active = pathname === href;
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
  );
}
