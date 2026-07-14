"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Notification } from "@/generated/prisma/client";

export function NotificationRow({ notification }: { notification: Notification }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isUnread = !notification.readAt;

  async function open() {
    if (isUnread) {
      fetch(`/api/notifications/${notification.id}`, { method: "PATCH" }).then(() => router.refresh());
    }
    if (notification.entityType === "Task") {
      const params = new URLSearchParams(searchParams.toString());
      params.set("taskId", notification.entityId);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open();
      }}
      className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3 text-sm transition-colors hover:bg-muted"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {isUnread ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden /> : null}
        <span className={cn("min-w-0 truncate", isUnread && "font-medium")}>{notification.message}</span>
      </div>
      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {formatDateTime(notification.createdAt)}
      </span>
    </div>
  );
}
