"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Lock, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { KindPill } from "@/components/tasks/kind-pill";
import { ProjectPicker, type ProjectOption } from "@/components/tasks/project-picker";
import { StatusPill } from "@/components/tasks/status-pill";
import { StagePill } from "@/components/programs/stage-pill";
import { TaskAssigneesPicker } from "@/components/tasks/task-assignees-picker";
import { CAMPAIGN_STAGE_LABELS, CAMPAIGN_STAGE_VALUES, campaignLabel } from "@/lib/campaign-stage";
import {
  TASK_KIND_LABELS,
  TASK_KIND_VALUES,
  TASK_OCCURRENCE_LABELS,
  TASK_OCCURRENCE_VALUES,
  TASK_STATUS_VALUES,
} from "@/lib/validations/task";
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
    status: task.status,
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
};

export function TaskDetailPanel({ clients, teamMembers, currentUserId }: Props) {
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
      setTask(null);
      setDraft(null);
      return;
    }
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
    if (isDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
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

  async function submitComment() {
    if (!taskId || !commentBody.trim()) return;
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

  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(open) => !open && close()}>
      <SheetContent className="flex flex-col gap-6 overflow-y-auto p-6">
        {task && draft ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle className="sr-only">Task details</SheetTitle>
              <Input
                value={draft.title}
                onChange={(event) => setField("title", event.target.value)}
                className="border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
              />
            </SheetHeader>

            {isDirty ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/40">
                <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Unsaved changes</span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={discard} disabled={isSaving}>
                    Discard
                  </Button>
                  <Button size="sm" onClick={save} disabled={isSaving}>
                    {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {isSaving ? "Saving..." : "Save changes"}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="task-description">Description</Label>
                <Textarea
                  id="task-description"
                  value={draft.description}
                  onChange={(event) => setField("description", event.target.value)}
                  placeholder="Add more detail about this task..."
                  className="min-h-20 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={draft.status} onValueChange={(value) => value && setField("status", value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(status: string) => <StatusPill status={status} />}</SelectValue>
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
                <div className="space-y-1.5">
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
                <label className="flex cursor-pointer items-center gap-3 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">
                  <Checkbox
                    checked={draft.isPrivate}
                    onCheckedChange={(checked) => setField("isPrivate", checked === true)}
                    className="size-5 border-2 border-blue-500"
                  />
                  <Lock className="size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-semibold">Private</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      Only you can see this task — turn off to make it visible to everyone.
                    </span>
                  </span>
                </label>
              ) : draft.isPrivate ? (
                <div className="flex items-center gap-3 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">
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
                      <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{comment.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              )}
              <div className="space-y-2">
                <Textarea
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="Leave a note for the team..."
                  className="min-h-16 text-sm"
                />
                <Button size="sm" disabled={isPostingComment || !commentBody.trim()} onClick={submitComment}>
                  {isPostingComment ? "Posting..." : "Add comment"}
                </Button>
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
