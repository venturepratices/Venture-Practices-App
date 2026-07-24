"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/tasks/status-pill";
import { TASK_OCCURRENCE_LABELS, TASK_OCCURRENCE_VALUES, TASK_STATUS_VALUES } from "@/lib/validations/task";
import { formatDateTime } from "@/lib/utils";
import type { TaskDetail } from "@/types/task";

const UNASSIGNED = "__unassigned__";
const NO_CLIENT = "__none__";

type Draft = {
  title: string;
  status: string;
  assigneeId: string;
  clientId: string;
  occurrence: string;
  deadline: string; // "YYYY-MM-DD" or ""
};

function draftFromTask(task: TaskDetail): Draft {
  return {
    title: task.title,
    status: task.status,
    assigneeId: task.assigneeId ?? UNASSIGNED,
    clientId: task.clientId ?? NO_CLIENT,
    occurrence: task.occurrence,
    deadline: task.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : "",
  };
}

type Props = {
  clients: { id: string; name: string }[];
  teamMembers: { id: string; name: string }[];
};

export function TaskDetailPanel({ clients, teamMembers }: Props) {
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

  const teamMemberNames = Object.fromEntries(teamMembers.map((m) => [m.id, m.name]));
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
    if (draft.status !== base.status) fields.status = draft.status;
    if (draft.assigneeId !== base.assigneeId) {
      fields.assigneeId = draft.assigneeId === UNASSIGNED ? null : draft.assigneeId;
    }
    if (draft.clientId !== base.clientId) {
      fields.clientId = draft.clientId === NO_CLIENT ? null : draft.clientId;
    }
    if (draft.occurrence !== base.occurrence) fields.occurrence = draft.occurrence;
    if (draft.deadline !== base.deadline) {
      fields.deadline = draft.deadline ? new Date(draft.deadline).toISOString() : null;
    }
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
                <Label>Assignee</Label>
                <Select value={draft.assigneeId} onValueChange={(value) => value && setField("assigneeId", value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: string) => (value === UNASSIGNED ? "Unassigned" : teamMemberNames[value])}</SelectValue>
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
