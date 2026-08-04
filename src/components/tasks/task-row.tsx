"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon, Lock } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KindPill } from "@/components/tasks/kind-pill";
import { StatusPill } from "@/components/tasks/status-pill";
import { TASK_KIND_LABELS } from "@/lib/validations/task";
import type { StatusOptionLite } from "@/lib/task-status-utils";
import { resolveStatusOption } from "@/lib/task-status-utils";
import { cn, formatDate } from "@/lib/utils";
import type { TaskWithRelations } from "@/types/task";

// Column widths keyed by the same column keys used by the visibility menu —
// order here defines column order in the grid. "Client" is only included
// when showClient is on (the per-client Tasks tab never shows its own name).
// defaultWidth is a starting point only — the user can drag each column
// wider (or narrower) and that preference persists (see useColumnWidths).
const OPTIONAL_COLUMNS: { key: string; label: string; defaultWidth: number; clientOnly?: boolean }[] = [
  { key: "client", label: "Client", defaultWidth: 120, clientOnly: true },
  { key: "due", label: "Due", defaultWidth: 110 },
  { key: "assignee", label: "Assignee", defaultWidth: 130 },
  { key: "relatedTo", label: "Related to", defaultWidth: 150 },
  { key: "createdBy", label: "Created by", defaultWidth: 120 },
  { key: "dateCreated", label: "Date created", defaultWidth: 110 },
];

export const TASK_COLUMN_KEYS = OPTIONAL_COLUMNS.map((c) => c.key);

export function taskColumnsFor(showClient?: boolean) {
  return OPTIONAL_COLUMNS.filter((c) => !c.clientOnly || showClient);
}

export function defaultTaskColumnWidths(showClient?: boolean) {
  return Object.fromEntries(taskColumnsFor(showClient).map((c) => [c.key, c.defaultWidth]));
}

// Grid template is computed at runtime (which columns are visible/how wide
// each is are both user preferences, not knowable at build time) and passed
// through a CSS variable rather than a Tailwind arbitrary-value class, since
// Tailwind can't generate a class for a value it never saw in the source.
function gridTemplateVar(showClient: boolean | undefined, visible: Set<string> | undefined, widths: Record<string, number>) {
  const cols = taskColumnsFor(showClient).filter((c) => !visible || visible.has(c.key));
  const template = ["20px", "minmax(0,1fr)", ...cols.map((c) => `${widths[c.key] ?? c.defaultWidth}px`), "120px"].join(" ");
  return { "--task-grid-cols": template } as React.CSSProperties;
}

const GRID_CLASS = "grid grid-cols-[20px_minmax(0,1fr)_120px] items-center gap-3 md:[grid-template-columns:var(--task-grid-cols)]";

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
        <span key={col.key} className="relative hidden min-w-0 truncate md:block">
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
};

export function TaskRow({ task, showClient, visibleColumns, widths, selectable, selected, onToggleSelect, statusOptions = [] }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const assigneeNames = task.assignees.map((a) => a.teamMember.name).join(", ") || "Unassigned";
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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openTask}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") openTask();
      }}
      style={gridTemplateVar(showClient, visibleColumns, resolvedWidths)}
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
        {task.description ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={task.description}>
            {task.description}
          </span>
        ) : null}
        <span className="mt-0.5 block truncate text-xs text-muted-foreground md:hidden">
          {[
            showClient ? task.client?.name ?? null : null,
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
        <span className="hidden min-w-0 truncate text-muted-foreground md:block" title={task.client?.name ?? undefined}>
          {task.client?.name ?? "—"}
        </span>
      ) : null}
      {isVisible("due") ? (
        <span className="hidden min-w-0 items-center gap-1 truncate whitespace-nowrap text-muted-foreground md:flex">
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
        <span className="hidden min-w-0 truncate text-muted-foreground md:block" title={assigneeNames}>
          {assigneeNames}
        </span>
      ) : null}
      {isVisible("relatedTo") ? (
        <span className="hidden min-w-0 truncate md:block" title={kindLabel}>
          <KindPill kind={task.kind} label={task.kind === "PROJECT" ? task.workflowInstance?.name : undefined} />
        </span>
      ) : null}
      {isVisible("createdBy") ? (
        <span className="hidden min-w-0 truncate text-muted-foreground md:block" title={task.createdBy?.name ?? undefined}>
          {task.createdBy?.name ?? "—"}
        </span>
      ) : null}
      {isVisible("dateCreated") ? (
        <span className="hidden min-w-0 truncate whitespace-nowrap text-muted-foreground md:block">
          {formatDate(task.createdAt)}
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
