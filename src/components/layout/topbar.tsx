import Link from "next/link";
import { CalendarDays, SlidersHorizontal } from "lucide-react";

import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { MobileMenuButton } from "@/components/layout/mobile-menu-button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export function TopBar({ unreadCount = 0 }: { unreadCount?: number }) {
  return (
    <header className="flex h-14 items-center border-b bg-card px-4 md:px-6">
      <MobileMenuButton />
      <div className="ml-auto flex min-w-0 items-center gap-1">
        <ThemeToggle />
        <NotificationBell unreadCount={unreadCount} />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notification settings"
          title="Notification settings"
          render={<Link href="/settings/notifications" />}
        >
          <SlidersHorizontal className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Calendar settings"
          title="Connect Google Calendar"
          render={<Link href="/settings/calendar" />}
        >
          <CalendarDays className="size-4" />
        </Button>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <SignOutButton />
        </form>
      </div>
    </header>
  );
}
