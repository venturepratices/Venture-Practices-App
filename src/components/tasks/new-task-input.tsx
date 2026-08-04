"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Lock, Plus } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { KindPill } from "@/components/tasks/kind-pill";
import { ProjectPicker, type ProjectOption } from "@/components/tasks/project-picker";
import { StatusPill } from "@/components/tasks/status-pill";
import { TaskAssigneesPicker } from "@/components/tasks/task-assignees-picker";
import { TASK_KIND_LABELS, TASK_KIND_VALUES, TASK_OCCURRENCE_LABELS, TASK_OCCURRENCE_VALUES } from "@/lib/validations/task";
import type { StatusOptionLite } from "@/lib/task-status-utils";
import { resolveStatusOption } from "@/lib/task-status-utils";

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
  statusOptions?: StatusOptionLite[];
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
  statusOptions = [],
}: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("NEXT_UP");
  const [occurrence, setOccurrence] = useState("NON_RECURRING");
  const [kind, setKind] = useState("TASK");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
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
    setKind("TASK");
    setSelectedProjectId(null);
    setIsPrivate(false);
    setAssigneeIds(assigneeId ? [assigneeId] : []);
    setClient(clientId ?? NO_CLIENT);
    setDeadline("");
  }

  // Loaded lazily, once, the first time Kind is set to "Project" — avoids a
  // fetch for the common case where a quick-added task is never a project.
  useEffect(() => {
    if (kind !== "PROJECT" || projects !== null) return;
    let cancelled = false;
    fetch(`/api/workflows`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { id: string; name: string; client: { name: string } | null }[] | null) => {
        if (!cancelled) setProjects(data ? data.map((w) => ({ id: w.id, name: w.name, clientName: w.client?.name ?? null })) : []);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, projects]);

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
        kind,
        isPrivate,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        ...(campaignId !== undefined ? { campaignId } : {}),
        ...(campaignStage !== undefined ? { campaignStage } : {}),
        ...(workflowInstanceId !== undefined
          ? { workflowInstanceId }
          : kind === "PROJECT"
            ? { workflowInstanceId: selectedProjectId }
            : {}),
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
              <SelectValue>{(value: string) => <StatusPill option={resolveStatusOption(statusOptions, value)} />}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <StatusPill option={option} />
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

        {workflowInstanceId === undefined ? (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Related to</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                if (!value) return;
                setKind(value);
                if (value !== "PROJECT") setSelectedProjectId(null);
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue>{(value: string) => <KindPill kind={value} />}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TASK_KIND_VALUES.map((k) => (
                  <SelectItem key={k} value={k}>
                    {TASK_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {workflowInstanceId === undefined && kind === "PROJECT" ? (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Project</Label>
          {projects ? (
            <ProjectPicker projects={projects} value={selectedProjectId} onChange={setSelectedProjectId} />
          ) : (
            <p className="text-xs text-muted-foreground">Loading projects...</p>
          )}
        </div>
      ) : null}

      <label className="flex cursor-pointer items-center gap-3 rounded-md border border-blue-300 bg-blue-50 p-2.5 text-sm dark:border-blue-800 dark:bg-blue-950/30">
        <Checkbox
          checked={isPrivate}
          onCheckedChange={(checked) => setIsPrivate(checked === true)}
          className="size-5 border-2 border-blue-500"
        />
        <Lock className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">Private — only you can see this task</span>
      </label>

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
