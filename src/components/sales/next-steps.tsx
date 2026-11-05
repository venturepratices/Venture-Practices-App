"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { ACTIVITY_TYPE_LABELS } from "@/lib/sales/constants";
import type { PanelActivity } from "@/lib/sales/deal-panel";
import { dayLabel, nextStepPill } from "@/lib/sales/format";
import { cn } from "@/lib/utils";
import { ACTIVITY_ICONS } from "@/components/sales/sales-pills";

// The panel's "Next steps" (mockup `.act`): the deal's open activities, soonest
// first, each with a round check to tick it done. The icon tile is red once
// the day has passed and amber all of the due day (day-level, spec 7.4). A
// ticked row shows as done straight away and leaves when the panel reloads.

export function NextSteps({
  activities,
  now,
  canEdit,
  onMarkDone,
}: {
  activities: PanelActivity[];
  now: Date;
  canEdit: boolean;
  onMarkDone: (activity: PanelActivity) => Promise<void>;
}) {
  // Rows ticked here and still waiting for the server or the reload.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());

  async function tick(activity: PanelActivity) {
    if (ticked.has(activity.id)) return;
    setTicked((current) => new Set(current).add(activity.id));
    await onMarkDone(activity);
    // Done or refused, the reload has the truth: a done row is gone, a refused one comes back unticked.
    setTicked((current) => {
      const next = new Set(current);
      next.delete(activity.id);
      return next;
    });
  }

  return (
    <section aria-labelledby="deal-panel-next-steps" className="grid gap-2">
      <h3 id="deal-panel-next-steps" className={SECTION_HEADING}>
        Next steps
      </h3>
      {activities.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">None scheduled.</p>
      ) : (
        <ul className="grid gap-1.5">
          {activities.map((activity) => {
            const due = new Date(activity.dueAt);
            const tone = nextStepPill(due, now).tone;
            const Icon = ACTIVITY_ICONS[activity.type];
            const done = ticked.has(activity.id);
            return (
              <li
                key={activity.id}
                className={cn(
                  "flex items-center gap-2 rounded-[9px] border bg-card py-1.5 pr-2.5 pl-1 transition-opacity duration-150",
                  done && "opacity-60",
                )}
              >
                <button
                  type="button"
                  aria-label={`Mark done: ${activity.subject}`}
                  disabled={!canEdit || done}
                  aria-disabled={!canEdit || undefined}
                  onClick={() => void tick(activity)}
                  className="group/check flex size-10 shrink-0 items-center justify-center rounded-full outline-none disabled:cursor-default focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full border-2 border-input text-transparent transition-[color,background-color,border-color,scale] duration-150 ease-out group-active/check:scale-90 motion-reduce:transition-none",
                      canEdit && "group-hover/check:border-green-600 group-hover/check:text-green-600",
                      done && "border-green-600 bg-green-600 text-white",
                    )}
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                </button>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-[7px] [&_svg]:size-4",
                    tone === "overdue"
                      ? "bg-status-danger text-status-danger-foreground"
                      : tone === "today"
                        ? "bg-status-warning text-status-warning-foreground"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("m-0 truncate text-[13px] font-semibold", done && "line-through")}>{activity.subject}</p>
                  <p className="m-0 text-xs text-muted-foreground">
                    {ACTIVITY_TYPE_LABELS[activity.type]} · {dayLabel(due, now)}
                    {tone === "overdue" ? " (overdue)" : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The small uppercase heading over each panel section (mockup `.sec h4`). */
export const SECTION_HEADING =
  "m-0 flex items-center gap-1.5 text-[11.5px] font-bold tracking-[0.06em] text-muted-foreground uppercase";
