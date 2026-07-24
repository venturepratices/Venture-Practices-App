import {
  AtSign,
  Check,
  Clock,
  MessageSquarePlus,
  RefreshCw,
  Upload,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { NotificationType } from "@/generated/prisma/enums";

const ICON_FOR: Record<NotificationType, LucideIcon> = {
  ASSIGNED: UserPlus,
  MENTIONED: AtSign,
  STATUS_CHANGED: RefreshCw,
  DEADLINE_CHANGED: Clock,
  COMMENTED: MessageSquarePlus,
  ASSET_UPLOADED: Upload,
  ASSET_COMMENTED: MessageSquarePlus,
  ASSET_DECIDED: Check,
  ASSET_APPROVED: Check,
  ASSET_CHANGES_REQUESTED: X,
  ASSET_DUE_SOON: Clock,
};

export function iconFor(type: NotificationType): LucideIcon {
  return ICON_FOR[type] ?? RefreshCw;
}

export function NotificationIcon({ type, unread }: { type: NotificationType; unread: boolean }) {
  const Icon = iconFor(type);
  return (
    <div
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        unread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
      )}
    >
      <Icon className="size-3.5" />
    </div>
  );
}
