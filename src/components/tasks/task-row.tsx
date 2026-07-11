"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { StatusPill } from "@/components/tasks/status-pill";
import type { TaskWithRelations } from "@/types/task";

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

  return (
    <div className="flex w-full items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-muted">
      {selectable ? (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect?.(task.id)}
          aria-label={`Select ${task.title}`}
          className="ml-1.5 shrink-0"
        />
      ) : null}
      <button type="button" onClick={openTask} className="flex flex-1 items-center gap-3 px-1.5 py-2.5 text-left text-sm">
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        {showClient && task.client ? (
          <span className="hidden max-w-[110px] shrink-0 truncate text-muted-foreground md:inline">{task.client.name}</span>
        ) : null}
        {task.deadline ? (
          <span className="hidden shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground md:flex">
            <CalendarIcon className="size-3.5" />
            {new Date(task.deadline).toLocaleDateString()}
          </span>
        ) : null}
        <span className="hidden max-w-[110px] shrink-0 truncate text-muted-foreground md:inline">
          {task.assignee?.name ?? "Unassigned"}
        </span>
        <StatusPill status={task.status} className="shrink-0" />
      </button>
    </div>
  );
}
