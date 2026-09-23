"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon, Lock } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KindPill } from "@/components/tasks/kind-pill";
import { PriorityPill } from "@/components/tasks/priority-pill";
import { StatusPill } from "@/components/tasks/status-pill";
import { TASK_KIND_LABELS } from "@/lib/validations/task";
import type { PriorityLevelOptionLite, StatusOptionLite } from "@/lib/task-status-utils";
import { resolveStatusOption } from "@/lib/task-status-utils";
import { stripHtml } from "@/lib/text-format";
import { defaultTaskColumnWidths, taskColumnsFor } from "@/lib/task-columns";
import { cn, formatDate } from "@/lib/utils";
import type { TaskWithRelations } from "@/types/task";

// Column-set constants and helpers now live in src/lib/task-columns.ts so a
// server component can compute a default `visibleColumns` set without pulling
// in this client module.
export { DEFAULT_HIDDEN_COLUMNS, TASK_COLUMN_KEYS, defaultTaskColumnWidths, taskColumnsFor } from "@/lib/task-columns";

const NO_PRIORITY = "__none__";

// Grid template is computed at runtime (which columns are visible/how wide
// each is are both user preferences, not knowable at build time) and passed
// through a CSS variable rather than a Tailwind arbitrary-value class, since
// Tailwind can't generate a class for a value it never saw in the source.
function gridTemplateVar(showClient: boolean | undefined, visible: Set<string> | undefined, widths: Record<string, number>) {
  const cols = taskColumnsFor(showClient).filter((c) => !visible || visible.has(c.key));
  // The title column gets a real pixel floor (not 0) so a wide set of visible
  // columns can never squeeze it down to unreadable — it's the one thing on
  // this row that must always stay legible; everything else is negotiable.
  const template = ["20px", "minmax(160px,1fr)", ...cols.map((c) => `${widths[c.key] ?? c.defaultWidth}px`), "120px"].join(" ");
  return { "--task-grid-cols": template } as React.CSSProperties;
}

// Below `lg`, only Task title + Status show (the two-column mobile template)
// — every optional column waits for `lg` rather than `md`, so a tablet-width
// or half-split-screen window doesn't jump straight into a crowded dense grid
// that has to squeeze the title to fit everything at once.
const GRID_CLASS = "grid grid-cols-[20px_minmax(0,1fr)_120px] items-center gap-3 lg:[grid-template-columns:var(--task-grid-cols)]";

export function TaskListHeader({
  showClient,
  visibleColumns,
  widths,
  onResizeColumn,
}: {
  showClient?: boolean;
  visibleColumns?: Set<string>;
  widths?: Record<string, number>;
  onResizeColumn?: (key: string, width: number, commit: boolean) => void;
}) {
  const columns = taskColumnsFor(showClient).filter((c) => !visibleColumns || visibleColumns.has(c.key));
  const resolvedWidths = widths ?? defaultTaskColumnWidths(showClient);
  return (
    <div
      style={gridTemplateVar(showClient, visibleColumns, resolvedWidths)}
      className={cn(GRID_CLASS, "w-full min-w-0 border-b px-1.5 py-2.5 text-xs font-bold tracking-wide text-foreground")}
    >
      <span />
      <span className="min-w-0">Task title</span>
      {columns.map((col) => (
        <span key={col.key} className="relative hidden min-w-0 truncate lg:block">
          {col.label}
          {onResizeColumn ? (
            <ColumnResizeHandle
              width={resolvedWidths[col.key] ?? col.defaultWidth}
              onResize={(width, commit) => onResizeColumn(col.key, width, commit)}
            />
          ) : null}
        </span>
      ))}
      <span className="min-w-0 justify-self-start">Status</span>
    </div>
  );
}

type Props = {
  task: TaskWithRelations;
  showClient?: boolean;
  visibleColumns?: Set<string>;
  widths?: Record<string, number>;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (taskId: string) => void;
  // Full live status list, needed only for the inline status-change dropdown
  // (the pill itself renders straight from task.statusOption). Optional so
  // callers that never let a task's status be changed inline can omit it —
  // the dropdown just won't render a full set of choices in that case.
  statusOptions?: StatusOptionLite[];
  // Same deal for the inline priority-change dropdown (the Priority column).
  priorityLevelOptions?: PriorityLevelOptionLite[];
  // Stagger delay for the entrance animation, in ms — callers rendering a
  // list pass index * 40 (capped) for a quick top-to-bottom ripple.
  delayMs?: number;
};

export function TaskRow({
  task,
  showClient,
  visibleColumns,
  widths,
  selectable,
  selected,
  onToggleSelect,
  statusOptions = [],
  priorityLevelOptions = [],
  delayMs,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const assigneeNames = task.assignees.map((a) => a.teamMember.name).join(", ") || "Unassigned";
  const descriptionPreview = task.description ? stripHtml(task.description) : "";
  const kindLabel = task.kind === "PROJECT" && task.workflowInstance ? task.workflowInstance.name : TASK_KIND_LABELS[task.kind] ?? task.kind;
  const columns = taskColumnsFor(showClient).filter((c) => !visibleColumns || visibleColumns.has(c.key));
  const isVisible = (key: string) => columns.some((c) => c.key === key);
  const resolvedWidths = widths ?? defaultTaskColumnWidths(showClient);

  function openTask() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("taskId", task.id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function updateStatus(status: string | null) {
    if (!status || status === task.statusId) return;
    const fromLabel = task.statusOption.label;
    const toLabel = resolveStatusOption(statusOptions, status).label;
    if (!window.confirm(`Change status of "${task.title}" from ${fromLabel} to ${toLabel}?`)) return;
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  async function updatePriority(value: string | null) {
    const priorityLevelId = !value || value === NO_PRIORITY ? null : value;
    if (priorityLevelId === (task.priorityLevelId ?? null)) return;
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priorityLevelId }),
    });
    router.refresh();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openTask}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") openTask();
      }}
      style={{ ...gridTemplateVar(showClient, visibleColumns, resolvedWidths), animationDelay: delayMs ? `${delayMs}ms` : undefined }}
      className={cn(GRID_CLASS, "w-full min-w-0 cursor-pointer animate-in rounded-md px-1.5 py-2.5 text-sm fade-in slide-in-from-bottom-1 transition-colors duration-300 hover:bg-muted")}
    >
      <span onClick={(e) => e.stopPropagation()} className="flex size-4 items-center">
        {selectable ? (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect?.(task.id)}
            aria-label={`Select ${task.title}`}
          />
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 truncate" title={task.title}>
          {task.isPrivate ? <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Private" /> : null}
          <span className="truncate">{task.title}</span>
        </span>
        {descriptionPreview ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={descriptionPreview}>
            {descriptionPreview}
          </span>
        ) : null}
        <span className="mt-0.5 block truncate text-xs text-muted-foreground lg:hidden">
          {[
            showClient ? task.client?.name ?? null : null,
            task.priorityLevel ? task.priorityLevel.label : null,
            task.deadline ? `Due ${formatDate(task.deadline)}` : null,
            assigneeNames,
            kindLabel,
            task.createdBy ? `Created by ${task.createdBy.name}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {isVisible("client") ? (
        <span className="hidden min-w-0 truncate text-muted-foreground lg:block" title={task.client?.name ?? undefined}>
          {task.client?.name ?? "—"}
        </span>
      ) : null}
      {isVisible("due") ? (
        <span className="hidden min-w-0 items-center gap-1 truncate whitespace-nowrap text-muted-foreground lg:flex">
          {task.deadline ? (
            <>
              <CalendarIcon className="size-3.5 shrink-0" />
              <span className="truncate">{formatDate(task.deadline)}</span>
            </>
          ) : (
            "—"
          )}
        </span>
      ) : null}
      {isVisible("assignee") ? (
        <span className="hidden min-w-0 truncate text-muted-foreground lg:block" title={assigneeNames}>
          {assigneeNames}
        </span>
      ) : null}
      {isVisible("relatedTo") ? (
        <span className="hidden min-w-0 truncate lg:block" title={kindLabel}>
          <KindPill kind={task.kind} label={task.kind === "PROJECT" ? task.workflowInstance?.name : undefined} />
        </span>
      ) : null}
      {isVisible("createdBy") ? (
        <span className="hidden min-w-0 truncate text-muted-foreground lg:block" title={task.createdBy?.name ?? undefined}>
          {task.createdBy?.name ?? "—"}
        </span>
      ) : null}
      {isVisible("dateCreated") ? (
        <span className="hidden min-w-0 truncate whitespace-nowrap text-muted-foreground lg:block">
          {formatDate(task.createdAt)}
        </span>
      ) : null}
      {isVisible("priority") ? (
        <span onClick={(e) => e.stopPropagation()} className="hidden min-w-0 justify-self-start lg:block">
          <Select value={task.priorityLevelId ?? NO_PRIORITY} onValueChange={updatePriority}>
            <SelectTrigger className="h-auto w-fit gap-1 rounded-full border-none bg-transparent p-0 shadow-none focus-visible:ring-0 data-[size=default]:h-auto [&_svg]:size-3">
              <SelectValue>
                {() =>
                  task.priorityLevel ? (
                    <PriorityPill option={task.priorityLevel} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PRIORITY}>No priority</SelectItem>
              {priorityLevelOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <PriorityPill option={option} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
      ) : null}
      <span onClick={(e) => e.stopPropagation()} className="min-w-0 justify-self-start">
        <Select value={task.statusId} onValueChange={updateStatus}>
          <SelectTrigger className="h-auto w-fit gap-1 rounded-full border-none bg-transparent p-0 shadow-none focus-visible:ring-0 data-[size=default]:h-auto [&_svg]:size-3">
            <SelectValue>{() => <StatusPill option={task.statusOption} />}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                <StatusPill option={option} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    </div>
  );
}
