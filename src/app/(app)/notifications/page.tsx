import { Bell } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "@/lib/utils";
import { InfoTip } from "@/components/info-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { NotificationFilters } from "@/components/notifications/notification-filters";
import { NotificationRow } from "@/components/notifications/notification-row";

type SearchParams = {
  q?: string;
  type?: string;
  read?: string;
  from?: string;
  to?: string;
};

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  const where: Prisma.NotificationWhereInput = { recipientId: session.user.id };
  if (params.q) where.message = { contains: params.q, mode: "insensitive" };
  if (params.type) where.type = params.type as Prisma.NotificationWhereInput["type"];
  if (params.read === "UNREAD") where.readAt = null;
  else if (params.read === "READ") where.readAt = { not: null };
  if (params.from || params.to) {
    where.createdAt = {
      ...(params.from ? { gte: new Date(params.from) } : {}),
      ...(params.to ? { lte: endOfDay(params.to) } : {}),
    };
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 150 }),
    prisma.notification.count({ where: { recipientId: session.user.id, readAt: null } }),
  ]);

  const hasFilters = Boolean(params.q || params.type || params.read || params.from || params.to);

  return (
    <div>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Notifications
          <InfoTip>
            You're notified when you're assigned to a task, @-mentioned in a comment, or when a task you're assigned
            to changes status, deadline, or gets a new comment. Click any row to open the task and mark it read.
          </InfoTip>
        </h1>
        <p className="mt-1 text-muted-foreground">Activity that's relevant to you, most recent first.</p>
      </div>

      <div className="mt-4">
        <NotificationFilters hasUnread={unreadCount > 0} />
      </div>

      <div className="mt-4 rounded-lg border divide-y">
        {notifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={hasFilters ? "No notifications match these filters." : "Nothing yet — you're all caught up."}
          />
        ) : (
          notifications.map((notification) => <NotificationRow key={notification.id} notification={notification} />)
        )}
      </div>
    </div>
  );
}
