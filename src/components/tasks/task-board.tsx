"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";

import { StatusPill } from "@/components/tasks/status-pill";
import { TaskCard } from "@/components/tasks/task-card";
import { TASK_STATUS_VALUES } from "@/lib/validations/task";
import type { TaskWithRelations } from "@/types/task";

function Column({
  status,
  tasks,
  onOpenTask,
  showClient,
}: {
  status: string;
  tasks: TaskWithRelations[];
  onOpenTask: (taskId: string) => void;
  showClient?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-lg border bg-muted/20 transition-colors ${isOver ? "bg-muted/50" : ""}`}
    >
      <div className="flex items-center justify-between border-b p-3">
        <StatusPill status={status} />
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onOpen={onOpenTask} showClient={showClient} />
        ))}
      </div>
    </div>
  );
}

export function TaskBoard({ tasks, showClientOnCards }: { tasks: TaskWithRelations[]; showClientOnCards?: boolean }) {
  const [localTasks, setLocalTasks] = useState(tasks);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function openTask(taskId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("taskId", taskId);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const newStatus = String(over.id);
    const taskId = String(active.id);
    const current = localTasks.find((t) => t.id === taskId);
    if (!current || current.status === newStatus) return;

    setLocalTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus as typeof t.status } : t)));

    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (response.ok) {
      router.refresh();
    } else {
      // Revert on failure
      setLocalTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: current.status } : t)));
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {TASK_STATUS_VALUES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={localTasks.filter((task) => task.status === status)}
            onOpenTask={openTask}
            showClient={showClientOnCards}
          />
        ))}
      </div>
    </DndContext>
  );
}
