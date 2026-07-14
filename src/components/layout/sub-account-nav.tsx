"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LOCAL_LINKS = [
  { segment: "", label: "Info" },
  { segment: "tasks", label: "Tasks" },
  { segment: "notes", label: "Notes" },
  { segment: "meetings", label: "Meeting Notes" },
  { segment: "conversations", label: "Conversations", cap: "conversations" as const },
  { segment: "calls", label: "Calls", cap: "conversations" as const },
  { segment: "assets", label: "Assets", comingSoon: true },
  { segment: "credentials", label: "Credentials", cap: "credentials" as const },
  { segment: "finance", label: "Finance", comingSoon: true },
];

export function SubAccountNav({
  clientId,
  canViewCredentials = false,
  canViewConversations = false,
}: {
  clientId: string;
  canViewCredentials?: boolean;
  canViewConversations?: boolean;
}) {
  const pathname = usePathname();

  const links = LOCAL_LINKS.filter((link) => {
    if (link.cap === "credentials") return canViewCredentials;
    if (link.cap === "conversations") return canViewConversations;
    return true;
  });

  return (
    <nav className="flex gap-1 overflow-x-auto border-b px-4 md:px-6">
      {links.map(({ segment, label, comingSoon }) => {
        const href = segment ? `/clients/${clientId}/${segment}` : `/clients/${clientId}`;
        const active = pathname === href;

        if (comingSoon) {
          return (
            <span
              key={segment}
              title="Coming in Phase 2"
              className="shrink-0 cursor-not-allowed border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground/50"
            >
              {label}
            </span>
          );
        }

        return (
          <Link
            key={segment}
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
