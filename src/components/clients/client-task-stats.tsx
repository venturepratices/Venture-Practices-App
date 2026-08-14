import { AlertTriangle, CalendarClock, FileCheck2, ListChecks } from "lucide-react";

import { buildTaskFilterHref, type TaskFilterParams } from "@/lib/task-filter-where";
import { StatCard } from "@/components/ui/stat-card";

type Props = {
  clientId: string;
  counts: { overdue: number; dueToday: number; open: number; needsDecision: number };
  /** The current query string, so a card click narrows the view instead of replacing it. */
  params: TaskFilterParams & { view?: string; page?: string };
};

/**
 * The dashboard strip above a client's task list: four headline numbers that
 * double as one-click filters on the list below.
 *
 * Deliberately NOT a copy of the client's full Dashboard/briefing page. That
 * page renders these same four numbers *plus* four complete task lists under
 * them; stacking all of it here would push the real task list below four
 * screens of tasks and show most of them twice. The numbers alone, wired to
 * filter the one real list, carry the same information in a fraction of the
 * height. The Dashboard tab keeps the detailed breakdown and its date picker
 * (and the morning Slack digest still deep-links to it).
 */
export function ClientTaskStats({ clientId, counts, params }: Props) {
  const basePath = `/clients/${clientId}/tasks`;
  const activeDeadline = params.deadline;
  const openActive = params.open === "1" && !params.status;

  // Every card toggles: clicking the one that's already filtering clears it.
  // Each also resets `page`, since page 3 of the old filter is meaningless
  // under a new one, and clears the explicit date range because the
  // where-builder lets a range outrank the preset (see task-filter-where.ts).
  function deadlineHref(value: "OVERDUE" | "TODAY") {
    return buildTaskFilterHref(basePath, params, {
      deadline: activeDeadline === value ? null : value,
      deadlineFrom: null,
      deadlineTo: null,
      page: null,
    });
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="Overdue"
        value={counts.overdue}
        icon={AlertTriangle}
        tone="accent"
        href={deadlineHref("OVERDUE")}
        delayMs={0}
        className={activeDeadline === "OVERDUE" ? "ring-2 ring-secondary-accent" : undefined}
      />
      <StatCard
        label="Due today"
        value={counts.dueToday}
        icon={CalendarClock}
        tone="primary"
        href={deadlineHref("TODAY")}
        delayMs={40}
        className={activeDeadline === "TODAY" ? "ring-2 ring-primary" : undefined}
      />
      <StatCard
        label="Open tasks"
        value={counts.open}
        icon={ListChecks}
        tone="primary"
        // Clears `status` as well: an explicit status filter outranks "open" in
        // the where-builder, so leaving one set would light this card up while
        // changing nothing about the list.
        href={buildTaskFilterHref(basePath, params, {
          open: openActive ? null : "1",
          status: null,
          page: null,
        })}
        delayMs={80}
        className={openActive ? "ring-2 ring-primary" : undefined}
      />
      {/* Not a task filter — assets awaiting a decision live on the Assets tab,
          so this one navigates there pre-filtered rather than pretending to
          narrow the task list. */}
      <StatCard
        label="Needs a decision"
        value={counts.needsDecision}
        icon={FileCheck2}
        tone="accent"
        href={`/clients/${clientId}/assets?status=IN_REVIEW`}
        delayMs={120}
      />
    </div>
  );
}
