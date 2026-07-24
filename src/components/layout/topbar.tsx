import Link from "next/link";
import { LogOut } from "lucide-react";

import { signOut } from "@/lib/auth";
import { initialsOf } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MobileMenuButton } from "@/components/layout/mobile-menu-button";
import { NotificationBell } from "@/components/layout/notification-bell";

export function TopBar({
  userName,
  userEmail,
  unreadCount = 0,
}: {
  userName?: string | null;
  userEmail?: string | null;
  unreadCount?: number;
}) {
  return (
    <header className="flex h-14 items-center border-b bg-card px-4 md:px-6">
      <MobileMenuButton />
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <NotificationBell unreadCount={unreadCount} />
        <div className="min-w-0 max-w-[100px] text-right text-sm leading-tight sm:max-w-[220px]">
          <p className="truncate font-medium">{userName ?? "Team member"}</p>
          <p className="truncate text-muted-foreground">{userEmail}</p>
        </div>
        <Link
          href="/change-password"
          aria-label="Change password"
          title="Change password"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground transition-opacity hover:opacity-80"
        >
          {userName ? initialsOf(userName) : "?"}
        </Link>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
            <LogOut className="size-4" />
          </Button>
        </form>
      </div>
    </header>
  );
}
