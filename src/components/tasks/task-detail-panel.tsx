"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusPill } from "@/components/tasks/status-pill";
import { TASK_OCCURRENCE_VALUES, TASK_STATUS_VALUES } from "@/lib/validations/task";
import type { TaskWithRelations } from "@/types/task";

const OCCURRENCE_LABELS: Record<string, string> = {
  RECURRING_WEEKLY: "Recurring Weekly",
  RECURRING_MONTHLY: "Recurring Monthly",
  RECURRING_QUARTERLY: "Recurring Quarterly",
  PROJECT: "Project",
  NON_RECURRING: "Non Recurring",
};

const UNASSIGNED = "__unassigned__";
const NO_CLIENT = "__none__";

type Props = {
  clients: { id: string; name: string }[];
  teamMembers: { id: string; name: string }[];
};

export function TaskDetailPanel({ clients, teamMembers }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const taskId = searchParams.get("taskId");

  const [task, setTask] = useState<TaskWithRelations | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/tasks/${taskId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TaskWithRelations | null) => {
        if (!cancelled) {
          setTask(data);
          setTitle(data?.title ?? "");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("taskId");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  async function patch(fields: Record<string, unknown>) {
    if (!taskId) return;
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (response.ok) {
      const updated = (await response.json()) as TaskWithRelations;
      setTask(updated);
      router.refresh();
    }
  }

  async function handleDelete() {
    if (!taskId) return;
    if (!window.confirm("Delete this task? It will be moved to the archive.")) return;
    const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (response.ok) {
      close();
      router.refresh();
    }
  }

  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(open) => !open && close()}>
      <SheetContent className="flex flex-col gap-6 overflow-y-auto p-6">
        {task ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle className="sr-only">Task details</SheetTitle>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => title.trim() && title !== task.title && patch({ title: title.trim() })}
                className="border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
              />
            </SheetHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={task.status} onValueChange={(value) => patch({ status: value })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUS_VALUES.map((status) => (
                      <SelectItem key={status} value={status}>
                        <StatusPill status={status} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Assignee</Label>
                <Select
                  value={task.assigneeId ?? UNASSIGNED}
                  onValueChange={(value) => patch({ assigneeId: value === UNASSIGNED ? null : value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {teamMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Client</Label>
                <Select
                  value={task.clientId ?? NO_CLIENT}
                  onValueChange={(value) => patch({ clientId: value === NO_CLIENT ? null : value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CLIENT}>Internal / Agency</SelectItem>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Occurrence</Label>
                <Select value={task.occurrence} onValueChange={(value) => patch({ occurrence: value })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_OCCURRENCE_VALUES.map((occurrence) => (
                      <SelectItem key={occurrence} value={occurrence}>
                        {OCCURRENCE_LABELS[occurrence]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="deadline">Deadline</Label>
                <Input
                  id="deadline"
                  type="date"
                  value={task.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : ""}
                  onChange={(event) =>
                    patch({ deadline: event.target.value ? new Date(event.target.value).toISOString() : null })
                  }
                />
              </div>
            </div>

            <div className="mt-auto border-t pt-4">
              <Button variant="destructive" onClick={handleDelete}>
                <Trash2 className="size-4" />
                Delete task
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
