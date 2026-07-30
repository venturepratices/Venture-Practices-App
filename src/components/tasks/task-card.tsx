"use client";

import { useDraggable } from "@dnd-kit/core";
import { CalendarIcon, Lock } from "lucide-react";

import { KindPill } from "@/components/tasks/kind-pill";
import { cn, formatDate } from "@/lib/utils";
import type { TaskWithRelations } from "@/types/task";

export function TaskCard({
  task,
  onOpen,
  showClient,
}: {
  task: TaskWithRelations;
  onOpen: (taskId: string) => void;
  showClient?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(task.id)}
      style={
        transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
      }
      className={cn(
        "cursor-pointer rounded-md border bg-card p-3 text-sm shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md",
        isDragging && "z-10 opacity-70 shadow-lg"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 truncate font-medium">
          {task.isPrivate ? <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Private" /> : null}
          <span className="truncate">{task.title}</span>
        </p>
        <KindPill kind={task.kind} label={task.kind === "PROJECT" ? task.workflowInstance?.name : undefined} className="shrink-0" />
      </div>
      {task.description ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{task.description}</p> : null}
      {showClient ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">{task.client?.name ?? "Internal / Agency"}</p>
      ) : null}
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">{task.assignees.map((a) => a.teamMember.name).join(", ") || "Unassigned"}</span>
        {task.deadline ? (
          <span className="flex items-center gap-1">
            <CalendarIcon className="size-3" />
            {formatDate(task.deadline)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
