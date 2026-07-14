import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";

export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Notifications"
      className="relative"
      nativeButton={false}
      render={<Link href="/notifications" />}
    >
      <Bell className="size-4" />
      {unreadCount > 0 ? (
        <span className="absolute right-0.5 top-0.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Button>
  );
}
