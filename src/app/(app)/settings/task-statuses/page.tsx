import { notFound } from "next/navigation";
import { ListChecks } from "lucide-react";

import { loadPermissions } from "@/lib/permissions";
import { getTaskStatusOptions } from "@/lib/task-status";
import { InfoTip } from "@/components/info-tip";
import { TaskStatusEditor } from "@/components/settings/task-status-editor";

export default async function TaskStatusesPage() {
  const perms = await loadPermissions();
  if (!perms?.isAdmin) notFound();

  const statusOptions = await getTaskStatusOptions();

  return (
    <div className="max-w-2xl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ListChecks className="size-6" />
          Task Statuses
          <InfoTip>
            The set of statuses every task in the app can be set to. Renaming or recoloring a status here applies
            instantly to every task currently on it. Deleting a status that's still in use requires picking a
            replacement first.
          </InfoTip>
        </h1>
        <p className="mt-1 text-muted-foreground">Manage the statuses tasks can be set to, app-wide.</p>
      </div>

      <div className="mt-6">
        <TaskStatusEditor initialOptions={statusOptions} />
      </div>
    </div>
  );
}
