import { LogOut } from "lucide-react";

import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { MobileMenuButton } from "@/components/layout/mobile-menu-button";
import { NotificationBell } from "@/components/layout/notification-bell";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

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
      <div className="ml-auto flex items-center gap-3">
        <NotificationBell unreadCount={unreadCount} />
        <div className="text-right text-sm leading-tight">
          <p className="font-medium">{userName ?? "Team member"}</p>
          <p className="text-muted-foreground">{userEmail}</p>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
          {userName ? initialsOf(userName) : "?"}
        </span>
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
