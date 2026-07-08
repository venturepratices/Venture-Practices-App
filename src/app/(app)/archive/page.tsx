import { prisma } from "@/lib/prisma";
import { StatusPill } from "@/components/tasks/status-pill";

export default async function ArchivePage() {
  const archivedTasks = await prisma.archivedTask.findMany({
    orderBy: { deletedAt: "desc" },
    take: 100,
    include: { deletedBy: { select: { name: true } } },
  });

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold">Archive</h1>
        <p className="mt-1 text-muted-foreground">
          Deleted tasks, kept here (and mirrored to durable storage) so nothing is ever truly lost.
        </p>
      </div>

      <div className="mt-6 rounded-lg border divide-y">
        {archivedTasks.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing has been deleted yet.</p>
        ) : (
          archivedTasks.map((task) => (
            <div key={task.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="flex-1 truncate line-through decoration-muted-foreground/50">{task.title}</span>
              <span className="hidden shrink-0 text-muted-foreground sm:inline">{task.clientName ?? "Internal"}</span>
              <span className="hidden shrink-0 text-muted-foreground sm:inline">{task.assigneeName ?? "Unassigned"}</span>
              <StatusPill status={task.status} className="shrink-0" />
              <span className="w-40 shrink-0 text-right text-xs text-muted-foreground">
                Deleted {new Date(task.deletedAt).toLocaleDateString()}
                {task.deletedBy ? ` by ${task.deletedBy.name}` : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
