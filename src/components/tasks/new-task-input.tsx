"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/tasks/status-pill";
import { TaskAssigneesPicker } from "@/components/tasks/task-assignees-picker";
import { TASK_OCCURRENCE_LABELS, TASK_OCCURRENCE_VALUES, TASK_STATUS_VALUES } from "@/lib/validations/task";

const NO_CLIENT = "__none__";

type Props = {
  clientId?: string | null;
  assigneeId?: string | null;
  lockClient?: boolean;
  clients?: { id: string; name: string }[];
  teamMembers?: { id: string; name: string }[];
  campaignId?: string | null;
  campaignStage?: string | null;
  workflowInstanceId?: string | null;
  workflowStageNumber?: number | null;
};

export function NewTaskInput({
  clientId,
  assigneeId,
  lockClient,
  clients = [],
  teamMembers = [],
  campaignId,
  campaignStage,
  workflowInstanceId,
  workflowStageNumber,
}: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("NEXT_UP");
  const [occurrence, setOccurrence] = useState("NON_RECURRING");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(assigneeId ? [assigneeId] : []);
  const [client, setClient] = useState(clientId ?? NO_CLIENT);
  const [deadline, setDeadline] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function resetFields() {
    setTitle("");
    setDescription("");
    setStatus("NEXT_UP");
    setOccurrence("NON_RECURRING");
    setAssigneeIds(assigneeId ? [assigneeId] : []);
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
        description: description.trim() || null,
        clientId: lockClient ? clientId ?? null : client === NO_CLIENT ? null : client,
        assigneeIds,
        status,
        occurrence,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        ...(campaignId !== undefined ? { campaignId } : {}),
        ...(campaignStage !== undefined ? { campaignStage } : {}),
        ...(workflowInstanceId !== undefined ? { workflowInstanceId } : {}),
        ...(workflowStageNumber !== undefined ? { workflowStageNumber } : {}),
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

      <Textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Description (optional)..."
        disabled={isPending}
        className="min-h-16 text-sm"
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
          <Label className="text-xs text-muted-foreground">Assignees</Label>
          <TaskAssigneesPicker teamMembers={teamMembers} value={assigneeIds} onChange={setAssigneeIds} triggerClassName="w-[160px]" />
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
