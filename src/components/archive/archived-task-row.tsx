"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { StatusPill } from "@/components/tasks/status-pill";
import { cn, formatDateTime } from "@/lib/utils";
import { ARCHIVE_GRID } from "@/components/archive/archive-grid";
import type { ArchivedTask } from "@/generated/prisma/client";

type Props = {
  task: ArchivedTask & { deletedBy: { name: string } | null };
};

export function ArchivedTaskRow({ task }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function open() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("archivedTaskId", task.id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open();
      }}
      className={cn(ARCHIVE_GRID, "w-full cursor-pointer items-center px-4 py-3 text-sm transition-colors hover:bg-muted")}
    >
      <span className="min-w-0 truncate line-through decoration-muted-foreground/50">{task.title}</span>
      <span className="hidden truncate text-muted-foreground md:block">{task.clientName ?? "Internal"}</span>
      <span className="hidden truncate text-muted-foreground md:block">{task.assigneeName ?? "Unassigned"}</span>
      <StatusPill status={task.status} className="justify-self-start" />
      <span className="hidden justify-self-end text-right text-xs text-muted-foreground md:block">
        Deleted {formatDateTime(task.deletedAt)}
        {task.deletedBy ? ` by ${task.deletedBy.name}` : ""}
      </span>
    </div>
  );
}
