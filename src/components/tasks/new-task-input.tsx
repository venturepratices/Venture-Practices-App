"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/tasks/status-pill";
import { TASK_OCCURRENCE_LABELS, TASK_OCCURRENCE_VALUES, TASK_STATUS_VALUES } from "@/lib/validations/task";

const UNASSIGNED = "__unassigned__";
const NO_CLIENT = "__none__";

type Props = {
  clientId?: string | null;
  assigneeId?: string | null;
  lockClient?: boolean;
  clients?: { id: string; name: string }[];
  teamMembers?: { id: string; name: string }[];
};

export function NewTaskInput({ clientId, assigneeId, lockClient, clients = [], teamMembers = [] }: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("NEXT_UP");
  const [occurrence, setOccurrence] = useState("NON_RECURRING");
  const [assignee, setAssignee] = useState(assigneeId ?? UNASSIGNED);
  const [client, setClient] = useState(clientId ?? NO_CLIENT);
  const [deadline, setDeadline] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function resetFields() {
    setTitle("");
    setStatus("NEXT_UP");
    setOccurrence("NON_RECURRING");
    setAssignee(assigneeId ?? UNASSIGNED);
    setClient(clientId ?? NO_CLIENT);
    setDeadline("");
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;

    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: trimmed,
        clientId: lockClient ? clientId ?? null : client === NO_CLIENT ? null : client,
        assigneeId: assignee === UNASSIGNED ? null : assignee,
        status,
        occurrence,
        deadline: deadline ? new Date(deadline).toISOString() : null,
      }),
    });

    if (response.ok) {
      resetFields();
      startTransition(() => router.refresh());
    }
  }

  function cancel() {
    setIsAdding(false);
    resetFields();
  }

  if (!isAdding) {
    return (
      <Button type="button" size="sm" className="gap-1.5" onClick={() => setIsAdding(true)}>
        <Plus className="size-4" />
        Add task
      </Button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-md border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancel();
        }}
        placeholder="Task title..."
        disabled={isPending}
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={(value) => value && setStatus(value)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue>{(value: string) => <StatusPill status={value} />}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUS_VALUES.map((s) => (
                <SelectItem key={s} value={s}>
                  <StatusPill status={s} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Assignee</Label>
          <Select value={assignee} onValueChange={(value) => value && setAssignee(value)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue>
                {(value: string) => (value === UNASSIGNED ? "Unassigned" : teamMembers.find((m) => m.id === value)?.name ?? value)}
              </SelectValue>
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

        {lockClient ? null : (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Client</Label>
            <Select value={client} onValueChange={(value) => value && setClient(value)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue>
                  {(value: string) => (value === NO_CLIENT ? "Internal / Agency" : clients.find((c) => c.id === value)?.name ?? value)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>Internal / Agency</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Occurrence</Label>
          <Select value={occurrence} onValueChange={(value) => value && setOccurrence(value)}>
            <SelectTrigger className="w-[170px]">
              <SelectValue>{(value: string) => TASK_OCCURRENCE_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TASK_OCCURRENCE_VALUES.map((o) => (
                <SelectItem key={o} value={o}>
                  {TASK_OCCURRENCE_LABELS[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Deadline</Label>
          <Input
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            className="h-8 w-[150px]"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending || !title.trim()}>
          Add task
        </Button>
      </div>
    </form>
  );
}
