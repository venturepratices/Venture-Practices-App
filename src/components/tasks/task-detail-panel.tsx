"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckSquare, Copy, ExternalLink, Loader2, Lock, Pencil, Plus, Trash2, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { KindPill } from "@/components/tasks/kind-pill";
import { ProjectPicker, type ProjectOption } from "@/components/tasks/project-picker";
import { StatusPill } from "@/components/tasks/status-pill";
import { StagePill } from "@/components/programs/stage-pill";
import { TaskAssigneesPicker } from "@/components/tasks/task-assignees-picker";
import { CAMPAIGN_STAGE_LABELS, CAMPAIGN_STAGE_VALUES, campaignLabel } from "@/lib/campaign-stage";
import { stripHtml } from "@/lib/text-format";
import { TASK_KIND_LABELS, TASK_KIND_VALUES, TASK_OCCURRENCE_LABELS, TASK_OCCURRENCE_VALUES } from "@/lib/validations/task";
import type { StatusOptionLite } from "@/lib/task-status-utils";
import { resolveStatusOption } from "@/lib/task-status-utils";
import { formatDateTime } from "@/lib/utils";
import type { TaskDetail } from "@/types/task";

const NO_CLIENT = "__none__";
const NO_CAMPAIGN = "__none__";

type CampaignOption = { id: string; sequenceNumber: number; name?: string | null; currentStage: string };

type Draft = {
  title: string;
  description: string;
  status: string;
  assigneeIds: string[];
  clientId: string;
  occurrence: string;
  deadline: string; // "YYYY-MM-DD" or ""
  campaignId: string;
  campaignStage: string;
  kind: string;
  workflowInstanceId: string | null;
  isPrivate: boolean;
};

function draftFromTask(task: TaskDetail): Draft {
  return {
    title: task.title,
    description: task.description ?? "",
    status: task.statusId,
    assigneeIds: task.assignees.map((a) => a.teamMemberId).sort(),
    clientId: task.clientId ?? NO_CLIENT,
    occurrence: task.occurrence,
    deadline: task.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : "",
    campaignId: task.campaignId ?? NO_CAMPAIGN,
    campaignStage: task.campaignStage ?? (task.campaign?.currentStage ?? "PLANNING"),
    kind: task.kind,
    workflowInstanceId: task.workflowInstanceId,
    isPrivate: task.isPrivate,
  };
}

type Props = {
  clients: { id: string; name: string }[];
  teamMembers: { id: string; name: string }[];
  currentUserId: string | null;
  statusOptions?: StatusOptionLite[];
};

export function TaskDetailPanel({ clients, teamMembers, currentUserId, statusOptions = [] }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const taskId = searchParams.get("taskId");

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOption[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [isPopulatingClients, setIsPopulatingClients] = useState(false);
  const [populateFeedback, setPopulateFeedback] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const clientNames = Object.fromEntries(clients.map((c) => [c.id, c.name]));

  const isDirty = Boolean(task && draft && JSON.stringify(draft) !== JSON.stringify(draftFromTask(task)));

  function refetchTask() {
    if (!taskId) return;
    fetch(`/api/tasks/${taskId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TaskDetail | null) => {
        // Refresh comments/links without clobbering in-progress field edits.
        if (data) setTask(data);
      });
  }

  useEffect(() => {
    if (!taskId) {
      // Clearing the panel's own state when it closes (taskId becomes null)
      // — not a prop-sync anti-pattern, just resetting local view state on
      // the way out, safe and intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTask(null);
      setDraft(null);
      return;
    }
    setIsEditingTitle(false);
    let cancelled = false;
    fetch(`/api/tasks/${taskId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TaskDetail | null) => {
        if (!cancelled) {
          setTask(data);
          setDraft(data ? draftFromTask(data) : null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Direct Mail campaigns for the task's client — only fetched once a
  // client-scoped task is open, since a campaign can't attach to a
  // client-less (internal) task. Silently empty (not an error state) for a
  // member without canViewDirectMail — the route 403s and the section just
  // doesn't render.
  useEffect(() => {
    const clientId = task?.clientId;
    if (!clientId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting this section's own state when there's no client to fetch for, not a prop-sync
      setCampaigns(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/campaigns?clientId=${clientId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: CampaignOption[] | null) => {
        if (!cancelled) setCampaigns(data);
      });
    return () => {
      cancelled = true;
    };
  }, [task?.clientId]);

  // Every project the current user can see, for the "which specific project"
  // search-picker — fetched once per opened task (not client-scoped, since a
  // project can be internal or belong to any client). Silently empty for a
  // member without canViewWorkflows, same pattern as the campaigns fetch.
  useEffect(() => {
    if (!taskId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting this section's own state on close, not a prop-sync
      setProjects(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/workflows`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { id: string; name: string; client: { name: string } | null }[] | null) => {
        if (!cancelled) setProjects(data ? data.map((w) => ({ id: w.id, name: w.name, clientName: w.client?.name ?? null })) : []);
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

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function discard() {
    if (task) setDraft(draftFromTask(task));
  }

  async function save() {
    if (!taskId || !task || !draft) return;
    const base = draftFromTask(task);
    const fields: Record<string, unknown> = {};
    if (draft.title.trim() && draft.title.trim() !== base.title) fields.title = draft.title.trim();
    if (draft.description !== base.description) fields.description = draft.description.trim() || null;
    if (draft.status !== base.status) fields.status = draft.status;
    if (JSON.stringify(draft.assigneeIds) !== JSON.stringify(base.assigneeIds)) {
      fields.assigneeIds = draft.assigneeIds;
    }
    if (draft.clientId !== base.clientId) {
      fields.clientId = draft.clientId === NO_CLIENT ? null : draft.clientId;
    }
    if (draft.occurrence !== base.occurrence) fields.occurrence = draft.occurrence;
    if (draft.deadline !== base.deadline) {
      fields.deadline = draft.deadline ? new Date(draft.deadline).toISOString() : null;
    }
    if (draft.campaignId !== base.campaignId) {
      fields.campaignId = draft.campaignId === NO_CAMPAIGN ? null : draft.campaignId;
    }
    if (draft.campaignId !== base.campaignId || draft.campaignStage !== base.campaignStage) {
      fields.campaignStage = draft.campaignId === NO_CAMPAIGN ? null : draft.campaignStage;
    }
    if (draft.kind !== base.kind) fields.kind = draft.kind;
    if (draft.workflowInstanceId !== base.workflowInstanceId) fields.workflowInstanceId = draft.workflowInstanceId;
    if (draft.isPrivate !== base.isPrivate) fields.isPrivate = draft.isPrivate;
    if (Object.keys(fields).length === 0) return;

    setIsSaving(true);
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    setIsSaving(false);
    if (response.ok) {
      const updated = (await response.json()) as TaskDetail;
      setTask(updated);
      setDraft(draftFromTask(updated));
      router.refresh();
    }
  }

  async function handleDelete() {
    if (!taskId) return;
    if (!window.confirm("Delete this task? It will be moved to the archive.")) return;
    const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (response.ok) {
      setDraft(null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("taskId");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
      router.refresh();
    }
  }

  async function handleDuplicate() {
    if (!taskId) return;
    setIsDuplicating(true);
    const response = await fetch(`/api/tasks/${taskId}/duplicate`, { method: "POST" });
    setIsDuplicating(false);
    if (response.ok) {
      const created = (await response.json()) as TaskDetail;
      const params = new URLSearchParams(searchParams.toString());
      params.set("taskId", created.id);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
      router.refresh();
    }
  }

  async function submitComment() {
    if (!taskId || !stripHtml(commentBody).trim()) return;
    setIsPostingComment(true);
    const response = await fetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: commentBody.trim() }),
    });
    setIsPostingComment(false);
    if (response.ok) {
      setCommentBody("");
      refetchTask();
    }
  }

  async function submitLink() {
    if (!taskId || !linkLabel.trim() || !linkUrl.trim()) return;
    setLinkError(null);
    const response = await fetch(`/api/tasks/${taskId}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: linkLabel.trim(), url: linkUrl.trim() }),
    });
    if (response.ok) {
      setLinkLabel("");
      setLinkUrl("");
      refetchTask();
    } else {
      const data = await response.json().catch(() => null);
      setLinkError(data?.error ?? "Couldn't add that link.");
    }
  }

  async function deleteLink(linkId: string) {
    const response = await fetch(`/api/task-links/${linkId}`, { method: "DELETE" });
    if (response.ok) refetchTask();
  }

  async function submitSubtask() {
    if (!taskId || !newSubtaskTitle.trim()) return;
    setIsAddingSubtask(true);
    const response = await fetch(`/api/tasks/${taskId}/subtasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newSubtaskTitle.trim() }),
    });
    setIsAddingSubtask(false);
    if (response.ok) {
      setNewSubtaskTitle("");
      refetchTask();
    }
  }

  async function populateWithAllClients() {
    if (!taskId || isPopulatingClients) return;
    setIsPopulatingClients(true);
    setPopulateFeedback(null);
    const response = await fetch(`/api/tasks/${taskId}/subtasks/bulk-populate-clients`, { method: "POST" });
    setIsPopulatingClients(false);
    if (!response.ok) {
      setPopulateFeedback("Couldn't add clients. Try again in a moment.");
      return;
    }
    const result = (await response.json().catch(() => null)) as { addedCount?: number; skippedCount?: number } | null;
    const added = result?.addedCount ?? 0;
    const skipped = result?.skippedCount ?? 0;
    if (added === 0 && skipped === 0) {
      setPopulateFeedback("No active clients to add.");
    } else if (added === 0) {
      setPopulateFeedback(`Already up to date — ${skipped} client${skipped === 1 ? "" : "s"} already listed.`);
    } else {
      setPopulateFeedback(
        `Added ${added} client${added === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} already listed)` : ""}.`
      );
    }
    router.refresh();
  }

  async function toggleSubtask(subtaskId: string, completed: boolean) {
    const response = await fetch(`/api/task-subtasks/${subtaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
    if (response.ok) refetchTask();
  }

  async function deleteSubtask(subtaskId: string) {
    const response = await fetch(`/api/task-subtasks/${subtaskId}`, { method: "DELETE" });
    if (response.ok) refetchTask();
  }

  return (
    <Dialog open={Boolean(taskId)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-w-[calc(100%-2rem)] flex-col gap-6 sm:max-w-2xl">
        {task && draft ? (
          <>
            <DialogHeader className="p-0">
              <DialogTitle className="sr-only">Task details</DialogTitle>
              <div className="flex items-center gap-2">
                {isEditingTitle ? (
                  <Input
                    autoFocus
                    value={draft.title}
                    onChange={(event) => setField("title", event.target.value)}
                    onBlur={() => setIsEditingTitle(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "Escape") {
                        event.preventDefault();
                        setIsEditingTitle(false);
                      }
                    }}
                    className="h-auto flex-1 px-2 py-1 text-xl font-bold tracking-tight"
                  />
                ) : (
                  <>
                    <h2 className="flex-1 truncate text-xl font-bold tracking-tight">
                      {draft.title || "Untitled task"}
                    </h2>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit title"
                      onClick={() => setIsEditingTitle(true)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </>
                )}
              </div>
            </DialogHeader>

            <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/40">
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                {isDirty ? "You have unsaved changes" : "No unsaved changes"}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={discard} disabled={isSaving || !isDirty}>
                  Discard
                </Button>
                <Button size="sm" onClick={save} disabled={isSaving || !isDirty}>
                  {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {isSaving ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="task-description">Description</Label>
                <RichTextEditor
                  content={draft.description}
                  onChange={(html) => setField("description", html)}
                  teamMembers={teamMembers}
                  placeholder="Add more detail about this task — what needs to happen, and any context the assignee should know."
                />
                <p className="text-xs text-muted-foreground">
                  Type <b>@</b> to mention someone. Links you type or paste go live automatically.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={draft.status} onValueChange={(value) => value && setField("status", value)}>
                  <SelectTrigger className="w-full">
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

              <div className="space-y-1.5">
                <Label>Related to</Label>
                <Select
                  value={draft.kind}
                  onValueChange={(value) => {
                    if (!value) return;
                    setDraft((prev) =>
                      prev ? { ...prev, kind: value, workflowInstanceId: value === "PROJECT" ? prev.workflowInstanceId : null } : prev
                    );
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{(kind: string) => <KindPill kind={kind} />}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_KIND_VALUES.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {TASK_KIND_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {draft.kind === "PROJECT" ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Project</Label>
                  {projects ? (
                    <ProjectPicker
                      projects={projects}
                      value={draft.workflowInstanceId}
                      onChange={(id) => setField("workflowInstanceId", id)}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">Loading projects...</p>
                  )}
                </div>
              ) : null}

              {task.createdById === null || task.createdById === currentUserId ? (
                <label className="flex cursor-pointer items-center gap-3 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm sm:col-span-2 dark:border-blue-800 dark:bg-blue-950/30">
                  <Checkbox
                    checked={draft.isPrivate}
                    onCheckedChange={(checked) => setField("isPrivate", checked === true)}
                    className="size-5 border-2 border-blue-500"
                  />
                  <Lock className="size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-semibold">Private</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      Only you can see this task — turn this off to make it visible to everyone.
                    </span>
                  </span>
                </label>
              ) : draft.isPrivate ? (
                <div className="flex items-center gap-3 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm sm:col-span-2 dark:border-blue-800 dark:bg-blue-950/30">
                  <Lock className="size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-semibold">Private</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      Only the task&apos;s creator can change this setting.
                    </span>
                  </span>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label>Assignees</Label>
                <TaskAssigneesPicker
                  teamMembers={teamMembers}
                  value={draft.assigneeIds}
                  onChange={(ids) => setField("assigneeIds", [...ids].sort())}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Client</Label>
                <Select value={draft.clientId} onValueChange={(value) => value && setField("clientId", value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: string) => (value === NO_CLIENT ? "Internal / Agency" : clientNames[value])}</SelectValue>
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
                <Select value={draft.occurrence} onValueChange={(value) => value && setField("occurrence", value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(occurrence: string) => TASK_OCCURRENCE_LABELS[occurrence]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_OCCURRENCE_VALUES.map((occurrence) => (
                      <SelectItem key={occurrence} value={occurrence}>
                        {TASK_OCCURRENCE_LABELS[occurrence]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {draft.occurrence !== "NON_RECURRING" && draft.occurrence !== "PROJECT" ? (
                  <p className="text-xs text-muted-foreground">
                    Marking this Complete will automatically create the next occurrence.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="deadline">Deadline</Label>
                <Input
                  id="deadline"
                  type="date"
                  value={draft.deadline}
                  onChange={(event) => setField("deadline", event.target.value)}
                />
              </div>

              {campaigns && campaigns.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>Direct Mail campaign</Label>
                  <Select
                    value={draft.campaignId}
                    onValueChange={(value) => {
                      if (!value) return;
                      const campaign = campaigns.find((c) => c.id === value);
                      setDraft((prev) =>
                        prev
                          ? { ...prev, campaignId: value, campaignStage: campaign?.currentStage ?? prev.campaignStage }
                          : prev
                      );
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(value: string) => {
                          if (value === NO_CAMPAIGN) return "None";
                          const campaign = campaigns.find((c) => c.id === value);
                          return campaign ? campaignLabel(campaign) : value;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CAMPAIGN}>None</SelectItem>
                      {campaigns.map((campaign) => (
                        <SelectItem key={campaign.id} value={campaign.id}>
                          {campaignLabel(campaign)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {draft.campaignId !== NO_CAMPAIGN ? (
                <div className="space-y-1.5">
                  <Label>Stage</Label>
                  <Select value={draft.campaignStage} onValueChange={(value) => value && setField("campaignStage", value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{(stage: string) => <StagePill stage={stage} />}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CAMPAIGN_STAGE_VALUES.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {CAMPAIGN_STAGE_LABELS[stage]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <CheckSquare className="size-4" />
                Subtasks
                {task.subtasks.length > 0 ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
                  </span>
                ) : null}
              </Label>
              {task.subtasks.length > 0 ? (
                <ul className="space-y-1">
                  {task.subtasks.map((subtask) => (
                    <li key={subtask.id} className="flex items-center gap-2.5 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
                      <Checkbox
                        checked={subtask.completed}
                        onCheckedChange={(checked) => toggleSubtask(subtask.id, checked === true)}
                      />
                      <span
                        className={
                          subtask.completed ? "flex-1 truncate text-muted-foreground line-through" : "flex-1 truncate"
                        }
                      >
                        {subtask.title}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${subtask.title}`}
                        onClick={() => deleteSubtask(subtask.id)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex items-center gap-1.5">
                <Input
                  value={newSubtaskTitle}
                  onChange={(event) => setNewSubtaskTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitSubtask();
                    }
                  }}
                  placeholder="Add subtask..."
                  className="h-8 text-sm"
                />
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Add subtask"
                  disabled={isAddingSubtask || !newSubtaskTitle.trim()}
                  onClick={submitSubtask}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-primary/40 bg-primary/5 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-xs sm:text-sm">
                  <p className="font-medium text-primary">Add all clients as subtasks</p>
                  <p className="text-xs text-muted-foreground">
                    One checkbox per active client · skips ones already listed
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={populateWithAllClients}
                  disabled={isPopulatingClients}
                  className="w-full shrink-0 sm:w-auto"
                >
                  {isPopulatingClients ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Users className="mr-1.5 size-3.5" />
                  )}
                  {task.subtasks.length > 0 ? "Add missing clients" : "Add all clients"}
                </Button>
              </div>
              {populateFeedback ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {populateFeedback}
                </p>
              ) : null}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Links</Label>
              {task.links.length > 0 ? (
                <ul className="space-y-1.5">
                  {task.links.map((link) => (
                    <li key={link.id} className="flex items-center gap-2 text-sm">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-1 items-center gap-1.5 truncate text-primary underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="size-3.5 shrink-0" />
                        <span className="truncate">{link.label}</span>
                      </a>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${link.label}`}
                        onClick={() => deleteLink(link.id)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex items-center gap-1.5">
                <Input
                  value={linkLabel}
                  onChange={(event) => setLinkLabel(event.target.value)}
                  placeholder="Label (e.g. Brief doc)"
                  className="h-8 text-sm"
                />
                <Input
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://..."
                  className="h-8 text-sm"
                />
                <Button variant="outline" size="icon-sm" aria-label="Add link" onClick={submitLink}>
                  <Plus className="size-4" />
                </Button>
              </div>
              {linkError ? <p className="text-sm text-destructive">{linkError}</p> : null}
            </div>

            <Separator />

            <div className="space-y-3">
              <Label>Comments</Label>
              {task.comments.length > 0 ? (
                <ul className="space-y-3">
                  {task.comments.map((comment) => (
                    <li key={comment.id} className="text-sm">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium">{comment.author?.name ?? "Former team member"}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(comment.createdAt)}
                        </span>
                      </div>
                      <RichTextContent html={comment.body} className="mt-0.5 whitespace-pre-wrap text-muted-foreground" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              )}
              <div className="space-y-2">
                <RichTextEditor
                  content={commentBody}
                  onChange={setCommentBody}
                  teamMembers={teamMembers}
                  placeholder="Leave a note for the team... type @ to mention someone"
                />
                <Button size="sm" disabled={isPostingComment || !stripHtml(commentBody).trim()} onClick={submitComment}>
                  {isPostingComment ? "Posting..." : "Add comment"}
                </Button>
              </div>
            </div>

            <div className="mt-auto flex items-center gap-2 border-t pt-4">
              <Button variant="outline" onClick={handleDuplicate} disabled={isDuplicating}>
                {isDuplicating ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
                {isDuplicating ? "Duplicating..." : "Duplicate"}
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                <Trash2 className="size-4" />
                Delete task
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
