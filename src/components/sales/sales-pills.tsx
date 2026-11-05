import { Clock, Coffee, Flag, Mail, Phone, SquareCheck, TriangleAlert, Users, type LucideIcon } from "lucide-react";

import type { SalesActivityType } from "@/generated/prisma/enums";
import { initials } from "@/lib/sales/board-client";
import { ACTIVITY_TYPE_LABELS } from "@/lib/sales/constants";
import { avatarTone, nextStepPill, type NextStepTone } from "@/lib/sales/format";
import { cn } from "@/lib/utils";

// The small pills a deal card, a list row and an activity row share (mockup
// `.pill`, `.av`): the next step with its day colour, days in stage (amber once
// the deal rots, Decision 12) and the owner's avatar. Colour is never the only
// signal: each pill also says it in words or with an icon (spec 7.11).

export const ACTIVITY_ICONS: Record<SalesActivityType, LucideIcon> = {
  CALL: Phone,
  MEETING: Users,
  TASK: SquareCheck,
  DEADLINE: Flag,
  EMAIL: Mail,
  LUNCH: Coffee,
};

const PILL = "inline-flex shrink-0 items-center gap-1 rounded-full px-[7px] py-0.5 text-[11px] leading-[1.4] font-semibold whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0";

const TONE_CLASS: Record<NextStepTone, string> = {
  overdue: "bg-status-danger text-status-danger-foreground",
  today: "bg-status-warning text-status-warning-foreground",
  future: "bg-status-success text-status-success-foreground",
  none: "bg-status-warning text-status-warning-foreground",
};

/** Next step: red when late, amber today, green later; "No next step" (amber, warning icon) when nothing is planned. */
export function NextStepPill({
  next,
  now,
  className,
}: {
  next: { type: SalesActivityType; dueAt: string; subject?: string } | null;
  now: Date;
  className?: string;
}) {
  const pill = nextStepPill(next ? new Date(next.dueAt) : null, now);
  const Icon = next ? ACTIVITY_ICONS[next.type] : TriangleAlert;
  return (
    <span className={cn(PILL, TONE_CLASS[pill.tone], className)} title={next?.subject}>
      <Icon aria-hidden="true" />
      {next ? <span className="sr-only">{ACTIVITY_TYPE_LABELS[next.type]}: </span> : null}
      {pill.label}
    </span>
  );
}

/** "9d" in this stage; amber with a clock once it has sat there too long. */
export function DaysPill({ days, rotting, className }: { days: number; rotting: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label={rotting ? `${days} days in this stage, idle too long` : `${days} days in this stage`}
      title="Days in this stage"
      className={cn(
        PILL,
        "tabular-nums",
        rotting ? "bg-status-warning text-status-warning-foreground" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {rotting ? <Clock aria-hidden="true" /> : null}
      {days}d
    </span>
  );
}

const AVATAR_TONES = ["bg-amber-300", "bg-teal-300", "bg-blue-300", "bg-violet-300"] as const;

/** The owner's initials in a 22px circle, coloured the same for the same person everywhere. */
export function OwnerAvatar({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`Owner: ${name}`}
      title={name}
      className={cn(
        "inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold text-slate-950 select-none",
        AVATAR_TONES[avatarTone(id)],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
