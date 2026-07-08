import { NewTaskInput } from "@/components/tasks/new-task-input";
import { TaskRow } from "@/components/tasks/task-row";
import type { TaskWithRelations } from "@/types/task";

type Props = {
  tasks: TaskWithRelations[];
  showClientColumn?: boolean;
  newTaskDefaults: { clientId?: string | null; assigneeId?: string | null };
};

export function TaskList({ tasks, showClientColumn, newTaskDefaults }: Props) {
  return (
    <div className="rounded-lg border">
      <div className="border-b px-3 py-1">
        <NewTaskInput clientId={newTaskDefaults.clientId} assigneeId={newTaskDefaults.assigneeId} />
      </div>
      {tasks.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <div className="divide-y">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} showClient={showClientColumn} />
          ))}
        </div>
      )}
    </div>
  );
}
