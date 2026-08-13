import {
  AlertTriangle,
  ArrowRightCircle,
  AtSign,
  Check,
  Clock,
  DollarSign,
  MessageSquarePlus,
  Newspaper,
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
  CAMPAIGN_STAGE_ADVANCED: ArrowRightCircle,
  CAMPAIGN_TASK_ASSIGNED: UserPlus,
  WORKFLOW_STAGE_STARTED: ArrowRightCircle,
  WORKFLOW_COMPLETED: Check,
  WORKFLOW_TASK_UP_NEXT: ArrowRightCircle,
  TASK_DUE_SOON: Clock,
  TASK_OVERDUE: AlertTriangle,
  ORDER_ADDED: DollarSign,
  ORDER_CHANGED: DollarSign,
  DAILY_BRIEFING: Newspaper,
};

export function iconFor(type: NotificationType): LucideIcon {
  return ICON_FOR[type] ?? RefreshCw;
}

export function NotificationIcon({ type, unread }: { type: NotificationType; unread: boolean }) {
  // iconFor() is a pure lookup into the static ICON_FOR map above; it always
  // returns the same stable icon-component reference for a given type, never
  // creates a new one, so this is a false positive for the "components must
  // not be created during render" check.
  const Icon = iconFor(type);
  return (
    <div
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        unread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
      )}
    >
      {/* eslint-disable-next-line react-hooks/static-components -- see comment above; Icon is a stable reference, not created here */}
      <Icon className="size-3.5" />
    </div>
  );
}
