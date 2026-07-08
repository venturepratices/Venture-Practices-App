"use client";

import { useDraggable } from "@dnd-kit/core";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TaskWithRelations } from "@/types/task";

export function TaskCard({ task, onOpen }: { task: TaskWithRelations; onOpen: (taskId: string) => void }) {
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
        "cursor-pointer rounded-md border bg-card p-3 text-sm shadow-sm transition-shadow hover:shadow-md",
        isDragging && "z-10 opacity-70 shadow-lg"
      )}
    >
      <p className="font-medium">{task.title}</p>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">{task.assignee?.name ?? "Unassigned"}</span>
        {task.deadline ? (
          <span className="flex items-center gap-1">
            <CalendarIcon className="size-3" />
            {new Date(task.deadline).toLocaleDateString()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
