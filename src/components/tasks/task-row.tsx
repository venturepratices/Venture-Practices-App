"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, TASK_STATUS_LABELS } from "@/components/tasks/status-pill";
import { TASK_STATUS_VALUES } from "@/lib/validations/task";
import { cn } from "@/lib/utils";
import type { TaskWithRelations } from "@/types/task";

export function taskRowGridClass(showClient?: boolean) {
  return cn(
    "grid grid-cols-[20px_minmax(0,1fr)_120px] items-center gap-3",
    showClient
      ? "md:grid-cols-[20px_minmax(0,1fr)_110px_100px_110px_120px]"
      : "md:grid-cols-[20px_minmax(0,1fr)_100px_110px_120px]"
  );
}

export function TaskListHeader({ showClient }: { showClient?: boolean }) {
  return (
    <div
      className={cn(
        taskRowGridClass(showClient),
        "w-full border-b px-1.5 py-2 text-xs font-medium tracking-wide text-muted-foreground"
      )}
    >
      <span />
      <span>Task</span>
      {showClient ? <span className="hidden md:block">Client</span> : null}
      <span className="hidden md:block">Due</span>
      <span className="hidden md:block">Assignee</span>
      <span className="justify-self-end">Status</span>
    </div>
  );
}

type Props = {
  task: TaskWithRelations;
  showClient?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (taskId: string) => void;
};

export function TaskRow({ task, showClient, selectable, selected, onToggleSelect }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openTask() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("taskId", task.id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function updateStatus(status: string | null) {
    if (!status || status === task.status) return;
    const fromLabel = TASK_STATUS_LABELS[task.status] ?? task.status;
    const toLabel = TASK_STATUS_LABELS[status] ?? status;
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
      className={cn(
        taskRowGridClass(showClient),
        "w-full cursor-pointer animate-in rounded-md px-1.5 py-2.5 text-sm fade-in slide-in-from-bottom-1 transition-colors duration-300 hover:bg-muted"
      )}
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
        <span className="block truncate">{task.title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground md:hidden">
          {[
            showClient ? task.client?.name ?? null : null,
            task.deadline ? `Due ${new Date(task.deadline).toLocaleDateString()}` : null,
            task.assignee?.name ?? "Unassigned",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {showClient ? (
        <span className="hidden truncate text-muted-foreground md:block">{task.client?.name ?? "—"}</span>
      ) : null}
      <span className="hidden items-center gap-1 whitespace-nowrap text-muted-foreground md:flex">
        {task.deadline ? (
          <>
            <CalendarIcon className="size-3.5" />
            {new Date(task.deadline).toLocaleDateString()}
          </>
        ) : (
          "—"
        )}
      </span>
      <span className="hidden truncate text-muted-foreground md:block">{task.assignee?.name ?? "Unassigned"}</span>
      <span onClick={(e) => e.stopPropagation()} className="justify-self-end">
        <Select value={task.status} onValueChange={updateStatus}>
          <SelectTrigger className="h-auto w-fit gap-1 rounded-full border-none bg-transparent p-0 shadow-none focus-visible:ring-0 data-[size=default]:h-auto [&_svg]:size-3">
            <SelectValue>{(status: string) => <StatusPill status={status} />}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TASK_STATUS_VALUES.map((status) => (
              <SelectItem key={status} value={status}>
                <StatusPill status={status} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    </div>
  );
}
