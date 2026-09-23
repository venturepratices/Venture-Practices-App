"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NotificationIcon } from "@/components/notifications/notification-icon";
import type { Notification } from "@/generated/prisma/client";

export function NotificationBell({
  unreadCount,
  recentNotifications,
}: {
  unreadCount: number;
  recentNotifications: Notification[];
}) {
  const [open, setOpen] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const previousCount = useRef(unreadCount);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (unreadCount > previousCount.current) {
      setPulsing(true);
      const timeout = setTimeout(() => setPulsing(false), 600);
      previousCount.current = unreadCount;
      return () => clearTimeout(timeout);
    }
    previousCount.current = unreadCount;
  }, [unreadCount]);

  // Close on outside click or Escape — standard popover behavior, no library
  // needed for something this small.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Same open/mark-read/navigate behavior as the full Notifications page's
  // own row (src/components/notifications/notification-row.tsx) — including
  // the legacy ?taskId= fallback for notifications created before linkPath
  // existed — just reachable from the bell instead of only from that page.
  async function openNotification(notification: Notification) {
    setOpen(false);
    if (!notification.readAt) {
      fetch(`/api/notifications/${notification.id}`, { method: "PATCH" }).then(() => router.refresh());
    }
    if (notification.linkPath) {
      router.push(notification.linkPath, { scroll: false });
    } else if (notification.entityType === "Task") {
      const params = new URLSearchParams(searchParams.toString());
      params.set("taskId", notification.entityId);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }

  const unread = recentNotifications.filter((n) => !n.readAt);
  const read = recentNotifications.filter((n) => n.readAt);

  return (
    <div ref={containerRef} className="relative">
      <Button variant="ghost" size="icon" aria-label="Notifications" aria-expanded={open} className="relative" onClick={() => setOpen((v) => !v)}>
        <Bell className={cn("size-4", pulsing && "animate-bounce")} />
        {unreadCount > 0 ? (
          <span className="absolute right-0.5 top-0.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] animate-in overflow-hidden rounded-lg border bg-card shadow-lg fade-in slide-in-from-top-1 duration-150">
          <div className="max-h-[70vh] overflow-y-auto">
            {recentNotifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
            ) : (
              <>
                {unread.length > 0 ? (
                  <div>
                    <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">New</p>
                    {unread.map((notification) => (
                      <NotificationItem key={notification.id} notification={notification} onOpen={openNotification} />
                    ))}
                  </div>
                ) : null}
                {read.length > 0 ? (
                  <div>
                    <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Earlier</p>
                    {read.map((notification) => (
                      <NotificationItem key={notification.id} notification={notification} onOpen={openNotification} />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-muted"
          >
            View all notifications
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function NotificationItem({ notification, onOpen }: { notification: Notification; onOpen: (notification: Notification) => void }) {
  const isUnread = !notification.readAt;
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted"
    >
      <NotificationIcon type={notification.type} unread={isUnread} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", isUnread && "font-medium")}>{notification.message}</span>
        <span className="text-xs text-muted-foreground">{formatDateTime(notification.createdAt)}</span>
      </span>
      {isUnread ? <span className="size-2 shrink-0 rounded-full bg-primary" /> : null}
    </button>
  );
}
