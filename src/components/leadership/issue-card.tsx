"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check, ChevronRight, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClientSelect } from "@/components/leadership/client-select";
import { IssueKindToggle } from "@/components/leadership/issue-kind-toggle";
import { IssueToRockDialog, IssueToTaskDialog } from "@/components/leadership/issue-action-dialogs";
import { PersonChip } from "@/components/leadership/person-chip";
import { cn, formatDate } from "@/lib/utils";

type Option = { id: string; name: string };

export type IssueRecommendation = {
  id: string;
  body: string;
  isDecision: boolean;
  createdAt: string;
  author: Option | null;
};

export type IssueCardData = {
  id: string;
  title: string;
  description: string | null;
  kind: "PROBLEM" | "SITUATION";
  status: "OPEN" | "SOLVED";
  topRank: number | null;
  client: Option | null;
  raisedBy: Option | null;
  convertedTaskId: string | null;
  rockId: string | null;
  createdAt: string;
  solvedAt: string | null;
  recommendations: IssueRecommendation[];
};

const NOT_TOP = "NONE";

export function IssueCard({
  issue,
  expanded,
  onToggle,
  clients,
  teamMembers,
  leadershipMembers,
}: {
  issue: IssueCardData;
  expanded: boolean;
  onToggle: () => void;
  clients: Option[];
  teamMembers: Option[];
  leadershipMembers: Option[];
}) {
  const router = useRouter();
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description ?? "");
  const [recommendation, setRecommendation] = useState("");
  const [busy, setBusy] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showRock, setShowRock] = useState(false);
  // The card re-renders from fresh server data after every save, so the local
  // draft has to be re-seeded when the row itself changes underneath it —
  // otherwise an edit made elsewhere would be masked by a stale draft.
  const [seededFrom, setSeededFrom] = useState(issue);
  if (seededFrom !== issue) {
    setSeededFrom(issue);
    if (!editingTitle) setTitle(issue.title);
    setDescription(issue.description ?? "");
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    router.refresh();
  }

  async function addRecommendation(event: React.FormEvent) {
    event.preventDefault();
    const body = recommendation.trim();
    if (!body) return;
    setBusy(true);
    const response = await fetch(`/api/issues/${issue.id}/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (response.ok) {
      setRecommendation("");
      router.refresh();
    }
  }

  async function setDecision(recommendationId: string, isDecision: boolean) {
    setBusy(true);
    await fetch(`/api/issue-recommendations/${recommendationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDecision }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Remove "${issue.title}" from the Issues List?`)) return;
    const response = await fetch(`/api/issues/${issue.id}`, { method: "DELETE" });
    if (response.ok) router.refresh();
  }

  const taskHref = issue.convertedTaskId
    ? issue.client
      ? `/clients/${issue.client.id}/tasks?taskId=${issue.convertedTaskId}`
      : `/tasks?taskId=${issue.convertedTaskId}`
    : null;
  const dateShown = issue.status === "SOLVED" && issue.solvedAt ? issue.solvedAt : issue.createdAt;

  return (
    <div className={cn("rounded-xl border bg-card transition-colors", expanded && "border-foreground/15")}>
      {/* Header — the whole strip toggles, so the title is plain text here and
          gets its own pencil rather than competing for the same click. */}
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          {issue.topRank ? (
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {issue.topRank}
            </span>
          ) : (
            <span className="mt-1 size-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />
          )}
          <span className="min-w-0 flex-1">
            {editingTitle ? null : <span className="block text-sm font-semibold leading-snug">{issue.title}</span>}
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
              {issue.client ? (
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground/80">{issue.client.name}</span>
              ) : null}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-medium",
                  issue.kind === "SITUATION"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : "bg-secondary-accent/15 text-secondary-accent"
                )}
              >
                {issue.kind === "SITUATION" ? "Just watching" : "Problem"}
              </span>
              <PersonChip name={issue.raisedBy?.name} className="text-xs" />
              <span>· {formatDate(dateShown, { month: "short", day: "numeric" })}</span>
              <span>
                ·{" "}
                {issue.recommendations.length === 0
                  ? "no ideas"
                  : `${issue.recommendations.length} ${issue.recommendations.length === 1 ? "idea" : "ideas"}`}
              </span>
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {expanded ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Edit title"
              onClick={() => {
                setTitle(issue.title);
                setEditingTitle((open) => !open);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
          <button type="button" onClick={onToggle} aria-label={expanded ? "Collapse" : "Expand"} className="p-1">
            <ChevronRight
              className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-90")}
            />
          </button>
        </div>
      </div>

      {editingTitle ? (
        <div className="flex gap-2 px-4 pb-4">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditingTitle(false);
            }}
          />
          <Button
            disabled={busy || !title.trim()}
            onClick={async () => {
              if (title.trim() && title.trim() !== issue.title) await patch({ title: title.trim() });
              setEditingTitle(false);
            }}
          >
            Save
          </Button>
        </div>
      ) : null}

      {expanded ? (
        <div className="border-t p-4">
          {/* One per line on a phone — side by side these overflow the card,
              since a client name can be long and the selects don't shrink. */}
          <div className="mb-4 grid gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-4">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <IssueKindToggle value={issue.kind} onChange={(kind) => patch({ kind })} disabled={busy} />
            </div>
            {issue.status === "OPEN" ? (
              <div className="grid min-w-0 gap-1">
                <Label className="text-xs text-muted-foreground">This week</Label>
                <Select
                  value={issue.topRank ? String(issue.topRank) : NOT_TOP}
                  onValueChange={(v) => patch({ topRank: !v || v === NOT_TOP ? null : Number(v) })}
                >
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue>{(v: string) => (v === NOT_TOP ? "Not in Top 3" : `Top 3 · #${v}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_TOP}>Not in Top 3</SelectItem>
                    <SelectItem value="1">Top 3 · #1</SelectItem>
                    <SelectItem value="2">Top 3 · #2</SelectItem>
                    <SelectItem value="3">Top 3 · #3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="grid min-w-0 gap-1 sm:flex-1">
              <Label className="text-xs text-muted-foreground">About</Label>
              <ClientSelect clients={clients} value={issue.client?.id ?? null} onChange={(clientId) => patch({ clientId })} />
            </div>
          </div>

          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description !== (issue.description ?? "")) void patch({ description: description.trim() || null });
            }}
            placeholder="Add more detail about this issue..."
            className="min-h-20 text-sm"
            aria-label="Issue details"
          />

          <p className="mt-5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Recommendations · {issue.recommendations.length}
          </p>
          <div className="mt-2 grid gap-2">
            {issue.recommendations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ideas yet. Add the first one below.</p>
            ) : null}
            {issue.recommendations.map((rec) => (
              <div
                key={rec.id}
                className={cn(
                  "rounded-lg border p-3",
                  rec.isDecision && "border-emerald-500/50 bg-emerald-500/10"
                )}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <PersonChip name={rec.author?.name} className="text-xs font-medium text-foreground" />
                  <span>{formatDate(rec.createdAt, { month: "short", day: "numeric" })}</span>
                  {rec.isDecision ? (
                    <span className="ml-auto flex items-center gap-2">
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">
                        DECISION
                      </span>
                      <button
                        type="button"
                        onClick={() => setDecision(rec.id, false)}
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Undo
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDecision(rec.id, true)}
                      className="ml-auto text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Mark as decision
                    </button>
                  )}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm">{rec.body}</p>
              </div>
            ))}
          </div>

          <form onSubmit={addRecommendation} className="mt-3 flex gap-2">
            <Input
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value)}
              placeholder="Add a recommendation..."
              aria-label="Add a recommendation"
            />
            <Button type="submit" variant="outline" disabled={busy || !recommendation.trim()}>
              Add
            </Button>
          </form>

          {taskHref || issue.rockId ? (
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              {taskHref ? (
                <Link href={taskHref} className="flex items-center gap-1 font-medium text-primary hover:underline">
                  View task <ArrowRight className="size-3" />
                </Link>
              ) : null}
              {issue.rockId ? (
                <Link href="/rocks" className="flex items-center gap-1 font-medium text-primary hover:underline">
                  View Rock <ArrowRight className="size-3" />
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setShowTask(true)}>
              Turn into task
            </Button>
            <Button variant="outline" onClick={() => setShowRock(true)}>
              Make it a Rock
            </Button>
            {issue.status === "OPEN" ? (
              <Button onClick={() => patch({ status: "SOLVED" })} disabled={busy}>
                <Check className="size-4" />
                Mark solved
              </Button>
            ) : (
              <Button variant="outline" onClick={() => patch({ status: "OPEN" })} disabled={busy}>
                Reopen
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={remove}
            >
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          </div>

          <IssueToTaskDialog
            open={showTask}
            onOpenChange={setShowTask}
            issueId={issue.id}
            teamMembers={teamMembers}
            onDone={() => router.refresh()}
          />
          <IssueToRockDialog
            open={showRock}
            onOpenChange={setShowRock}
            issueId={issue.id}
            leadershipMembers={leadershipMembers}
            onDone={() => router.refresh()}
          />
        </div>
      ) : null}
    </div>
  );
}
