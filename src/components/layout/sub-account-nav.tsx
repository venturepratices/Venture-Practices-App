"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Order is deliberate, per Ben's 2026-07-31 request: Info/Tasks/Projects first
// (the three most-used tabs), then the rest in their prior relative order.
// This is a plain hardcoded array with no persisted ordering concept — a true
// drag-and-drop "rearrange anytime" admin UI was considered and explicitly not
// built (see plan file), so reordering again later means editing this array.
const LOCAL_LINKS = [
  { segment: "", label: "Info" },
  { segment: "tasks", label: "Tasks" },
  { segment: "workflows", label: "Projects", cap: "workflows" as const },
  { segment: "notes", label: "Notes" },
  { segment: "meetings", label: "Meeting Notes" },
  { segment: "conversations", label: "Conversations", cap: "conversations" as const },
  { segment: "calls", label: "Calls", cap: "conversations" as const },
  { segment: "assets", label: "Assets", cap: "assets" as const },
  { segment: "campaigns", label: "Direct Mail", cap: "directMail" as const },
  { segment: "credentials", label: "Credentials", cap: "credentials" as const },
  { segment: "finance", label: "Finance", comingSoon: true },
];

export function SubAccountNav({
  clientId,
  canViewCredentials = false,
  canViewConversations = false,
  canViewAssets = false,
  canViewDirectMail = false,
  canViewWorkflows = false,
}: {
  clientId: string;
  canViewCredentials?: boolean;
  canViewConversations?: boolean;
  canViewAssets?: boolean;
  canViewDirectMail?: boolean;
  canViewWorkflows?: boolean;
}) {
  const pathname = usePathname();

  const links = LOCAL_LINKS.filter((link) => {
    if (link.cap === "credentials") return canViewCredentials;
    if (link.cap === "conversations") return canViewConversations;
    if (link.cap === "assets") return canViewAssets;
    if (link.cap === "directMail") return canViewDirectMail;
    if (link.cap === "workflows") return canViewWorkflows;
    return true;
  });

  return (
    <div className="relative border-b">
      <nav className="flex gap-1 overflow-x-auto px-4 md:px-6">
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
      {/* Fade hints there's more to scroll to on narrow screens; hidden at md+
          where every tab fits without scrolling. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent md:hidden" />
    </div>
  );
}
