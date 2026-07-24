"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const [pulsing, setPulsing] = useState(false);
  const previousCount = useRef(unreadCount);

  useEffect(() => {
    if (unreadCount > previousCount.current) {
      setPulsing(true);
      const timeout = setTimeout(() => setPulsing(false), 600);
      previousCount.current = unreadCount;
      return () => clearTimeout(timeout);
    }
    previousCount.current = unreadCount;
  }, [unreadCount]);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Notifications"
      className="relative"
      nativeButton={false}
      render={<Link href="/notifications" />}
    >
      <Bell className={cn("size-4", pulsing && "animate-bounce")} />
      {unreadCount > 0 ? (
        <span className="absolute right-0.5 top-0.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Button>
  );
}
