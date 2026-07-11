"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon } from "lucide-react";

import { StatusPill } from "@/components/tasks/status-pill";
import type { TaskWithRelations } from "@/types/task";

export function TaskRow({ task, showClient }: { task: TaskWithRelations; showClient?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openTask() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("taskId", task.id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <button
      type="button"
      onClick={openTask}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
    >
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
  );
}
