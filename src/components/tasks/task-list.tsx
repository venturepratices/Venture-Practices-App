"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ListChecks, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ColumnVisibilityMenu } from "@/components/ui/column-visibility-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { NewTaskInput } from "@/components/tasks/new-task-input";
import { TaskListHeader, TaskRow, taskColumnsFor, defaultTaskColumnWidths } from "@/components/tasks/task-row";
import { useColumnVisibility } from "@/lib/use-column-visibility";
import { useColumnWidths } from "@/lib/use-column-widths";
import type { TaskWithRelations } from "@/types/task";

type Props = {
  tasks: TaskWithRelations[];
  showClientColumn?: boolean;
  newTaskDefaults: { clientId?: string | null; assigneeId?: string | null };
  lockClient?: boolean;
  clients?: { id: string; name: string }[];
  teamMembers?: { id: string; name: string }[];
};

export function TaskList({ tasks, showClientColumn, newTaskDefaults, lockClient, clients, teamMembers }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isArchiving, setIsArchiving] = useState(false);
  const columns = taskColumnsFor(showClientColumn);
  const { visible: visibleColumns, toggle: toggleColumn } = useColumnVisibility(
    "taskListColumns",
    columns.map((c) => c.key)
  );
  const { widths: columnWidths, setWidth: setColumnWidth, resetWidths } = useColumnWidths(
    "taskListColumnWidths",
    defaultTaskColumnWidths(showClientColumn)
  );

  function toggleSelect(taskId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  async function archiveSelected() {
    if (selected.size === 0) return;
    if (!window.confirm(`Archive ${selected.size} task${selected.size === 1 ? "" : "s"}? This moves them to the archive.`)) {
      return;
    }
    setIsArchiving(true);
    await Promise.all([...selected].map((taskId) => fetch(`/api/tasks/${taskId}`, { method: "DELETE" })));
    setIsArchiving(false);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="rounded-lg border">
      <div className="flex items-start justify-between gap-3 border-b px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <NewTaskInput
            clientId={newTaskDefaults.clientId}
            assigneeId={newTaskDefaults.assigneeId}
            lockClient={lockClient}
            clients={clients}
            teamMembers={teamMembers}
          />
        </div>
        <ColumnVisibilityMenu columns={columns} visible={visibleColumns} onToggle={toggleColumn} onResetWidths={resetWidths} />
      </div>

      {selected.size > 0 ? (
        <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm">
          <span>{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={isArchiving} onClick={archiveSelected}>
              <Trash2 className="size-4" />
              {isArchiving ? "Archiving..." : "Archive selected"}
            </Button>
          </div>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <EmptyState icon={ListChecks} title="No tasks yet." className="py-6" />
      ) : (
        <div className="divide-y">
          <TaskListHeader
            showClient={showClientColumn}
            visibleColumns={visibleColumns}
            widths={columnWidths}
            onResizeColumn={setColumnWidth}
          />
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              showClient={showClientColumn}
              visibleColumns={visibleColumns}
              widths={columnWidths}
              selectable
              selected={selected.has(task.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
