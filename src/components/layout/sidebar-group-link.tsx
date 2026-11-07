import Link from "next/link";
import { CalendarCheck, ChartColumn, Inbox, LayoutDashboard, Settings, SquareKanban, Users, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SidebarNavGroup } from "@/components/layout/sidebar";

// One link of a data-driven sidebar group. Kept in its own file, apart from
// the sidebar's sign-in and password imports, so it renders on its own. Like
// the sidebar, it ships to every signed-in person, so it names no area: the
// label, path, icon key and the count's screen-reader words all arrive as data.

export const NAV_LINK = "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors";
export const NAV_LINK_ACTIVE =
  "bg-sidebar-primary text-sidebar-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_1px_3px_0_rgba(0,0,0,0.3)]";
export const NAV_LINK_IDLE = "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground";

type GroupLink = SidebarNavGroup["links"][number];

/** Neutral icon keys a group link may name. */
export const ICONS = {
  board: SquareKanban,
  calendar: CalendarCheck,
  home: LayoutDashboard,
  inbox: Inbox,
  people: Users,
  chart: ChartColumn,
  settings: Settings,
} satisfies Record<GroupLink["icon"], LucideIcon>;

export function SidebarGroupLink({ link, active }: { link: GroupLink; active: boolean }) {
  const Icon = ICONS[link.icon];
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        NAV_LINK,
        "pointer-coarse:min-h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring",
        active ? NAV_LINK_ACTIVE : NAV_LINK_IDLE,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{link.label}</span>
      {link.count > 0 ? (
        <span className="ml-auto shrink-0 rounded-full bg-white/10 px-1.5 text-[11px] font-bold tabular-nums">
          {link.count}
          {/* One string, so the page reads "2 open items" with no break inside. */}
          <span className="sr-only">{` ${link.countLabel}`}</span>
        </span>
      ) : null}
    </Link>
  );
}
