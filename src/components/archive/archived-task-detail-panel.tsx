"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusPill } from "@/components/tasks/status-pill";
import { TASK_OCCURRENCE_LABELS } from "@/lib/validations/task";
import { formatDateTime } from "@/lib/utils";
import type { ArchivedCommentSnapshot, ArchivedLinkSnapshot, ArchivedTaskDetail } from "@/types/task";

export function ArchivedTaskDetailPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const archivedTaskId = searchParams.get("archivedTaskId");

  const [task, setTask] = useState<ArchivedTaskDetail | null>(null);

  useEffect(() => {
    if (!archivedTaskId) {
      setTask(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/archived-tasks/${archivedTaskId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ArchivedTaskDetail | null) => {
        if (!cancelled) setTask(data);
      });
    return () => {
      cancelled = true;
    };
  }, [archivedTaskId]);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("archivedTaskId");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const comments = (task?.comments as ArchivedCommentSnapshot[] | null) ?? [];
  const links = (task?.links as ArchivedLinkSnapshot[] | null) ?? [];

  return (
    <Sheet open={Boolean(archivedTaskId)} onOpenChange={(open) => !open && close()}>
      <SheetContent className="flex flex-col gap-6 overflow-y-auto p-6">
        {task ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle className="text-lg font-semibold line-through decoration-muted-foreground/50">
                {task.title}
              </SheetTitle>
              <p className="text-xs text-muted-foreground">
                Deleted {formatDateTime(task.deletedAt)}
                {task.deletedBy ? ` by ${task.deletedBy.name}` : ""} — read-only, kept for backtracking.
              </p>
            </SheetHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Status</p>
                <StatusPill status={task.status} />
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Assignee</p>
                <p className="text-sm text-muted-foreground">{task.assigneeName ?? "Unassigned"}</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Client</p>
                <p className="text-sm text-muted-foreground">{task.clientName ?? "Internal / Agency"}</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Occurrence</p>
                <p className="text-sm text-muted-foreground">{TASK_OCCURRENCE_LABELS[task.occurrence]}</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Deadline</p>
                <p className="text-sm text-muted-foreground">
                  {task.deadline ? new Date(task.deadline).toLocaleDateString() : "No deadline"}
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium">Links</p>
              {links.length > 0 ? (
                <ul className="space-y-1.5">
                  {links.map((link, index) => (
                    <li key={index} className="text-sm">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 truncate text-primary underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="size-3.5 shrink-0" />
                        <span className="truncate">{link.label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No links were attached.</p>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <p className="text-sm font-medium">Comments</p>
              {comments.length > 0 ? (
                <ul className="space-y-3">
                  {comments.map((comment, index) => (
                    <li key={index} className="text-sm">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium">{comment.authorName}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{comment.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No comments were left.</p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
