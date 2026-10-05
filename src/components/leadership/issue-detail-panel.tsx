"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ClientSelect } from "@/components/leadership/client-select";
import { IssueKindToggle } from "@/components/leadership/issue-kind-toggle";
import { IssueToRockDialog, IssueToTaskDialog } from "@/components/leadership/issue-action-dialogs";
import { PersonChip } from "@/components/leadership/person-chip";
import { cn, formatDate } from "@/lib/utils";

type Option = { id: string; name: string };

type IssueDetail = {
  id: string;
  title: string;
  description: string | null;
  kind: "PROBLEM" | "SITUATION";
  status: "OPEN" | "SOLVED";
  topRank: number | null;
  clientId: string | null;
  convertedTaskId: string | null;
  rockId: string | null;
  createdAt: string;
  raisedBy: Option | null;
  recommendations: { id: string; body: string; isDecision: boolean; createdAt: string; author: Option | null }[];
};

const NOT_TOP = "NONE";

export function IssueDetailPanel({
  clients,
  teamMembers,
  leadershipMembers,
}: {
  clients: Option[];
  teamMembers: Option[];
  leadershipMembers: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const issueId = searchParams.get("issueId");

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [addingRec, setAddingRec] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showRock, setShowRock] = useState(false);

  async function load(id: string) {
    const response = await fetch(`/api/issues/${id}`);
    return response.ok ? ((await response.json()) as IssueDetail) : null;
  }

  useEffect(() => {
    if (!issueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting this panel's own state on close, not a prop-sync
      setIssue(null);
      return;
    }
    let cancelled = false;
    load(issueId).then((data) => {
      if (cancelled) return;
      setIssue(data);
      setTitle(data?.title ?? "");
      setDescription(data?.description ?? "");
      setRecommendation("");
    });
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  async function refresh() {
    if (issueId) setIssue(await load(issueId));
    router.refresh();
  }

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("issueId");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  async function patch(body: Record<string, unknown>) {
    if (!issueId) return;
    await fetch(`/api/issues/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await refresh();
  }

  async function addRecommendation(event: React.FormEvent) {
    event.preventDefault();
    if (!issueId || !recommendation.trim()) return;
    setAddingRec(true);
    const response = await fetch(`/api/issues/${issueId}/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: recommendation.trim() }),
    });
    setAddingRec(false);
    if (response.ok) {
      setRecommendation("");
      await refresh();
    }
  }

  async function setDecision(recommendationId: string, isDecision: boolean) {
    await fetch(`/api/issue-recommendations/${recommendationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDecision }),
    });
    await refresh();
  }

  async function remove() {
    if (!issue) return;
    if (!window.confirm(`Remove "${issue.title}" from the Issues List?`)) return;
    const response = await fetch(`/api/issues/${issue.id}`, { method: "DELETE" });
    if (response.ok) {
      close();
      router.refresh();
    }
  }

  const taskHref = issue?.convertedTaskId
    ? issue.clientId
      ? `/clients/${issue.clientId}/tasks?taskId=${issue.convertedTaskId}`
      : `/tasks?taskId=${issue.convertedTaskId}`
    : null;

  return (
    <>
      <Sheet open={Boolean(issueId)} onOpenChange={(open) => !open && close()}>
        <SheetContent className="flex w-full flex-col gap-5 overflow-y-auto p-5 sm:max-w-lg sm:p-6">
          {issue ? (
            <>
              <SheetHeader className="gap-1 p-0 pr-8">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {issue.status === "SOLVED" ? "Solved" : issue.topRank ? `Top 3 · #${issue.topRank}` : "Open issue"}
                </p>
                <SheetTitle className="sr-only">Issue details</SheetTitle>
                <Textarea
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => title.trim() && title.trim() !== issue.title && patch({ title: title.trim() })}
                  rows={2}
                  className="min-h-0 resize-none border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
                  aria-label="Issue title"
                />
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <PersonChip name={issue.raisedBy?.name} className="text-xs" />
                  <span>· {formatDate(issue.createdAt, { month: "short", day: "numeric" })}</span>
                </div>
              </SheetHeader>

              <div className="flex flex-wrap gap-4">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <IssueKindToggle value={issue.kind} onChange={(kind) => patch({ kind })} />
                </div>
                {issue.status === "OPEN" ? (
                  <div className="grid gap-1">
                    <Label className="text-xs text-muted-foreground">This week</Label>
                    <Select
                      value={issue.topRank ? String(issue.topRank) : NOT_TOP}
                      onValueChange={(v) => patch({ topRank: !v || v === NOT_TOP ? null : Number(v) })}
                    >
                      <SelectTrigger className="w-40">
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
                <div className="grid w-full gap-1">
                  <Label className="text-xs text-muted-foreground">About</Label>
                  <ClientSelect clients={clients} value={issue.clientId} onChange={(clientId) => patch({ clientId })} />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="issue-detail-description" className="text-xs text-muted-foreground">
                  Details
                </Label>
                <Textarea
                  id="issue-detail-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => description !== (issue.description ?? "") && patch({ description: description.trim() || null })}
                  placeholder="Add more context..."
                  className="min-h-20 text-sm"
                />
              </div>

              <Separator />

              <div className="grid gap-3">
                <p className="text-sm font-semibold">
                  Recommendations <span className="font-normal text-muted-foreground">{issue.recommendations.length}</span>
                </p>
                {issue.recommendations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No ideas yet. Add the first one below.</p>
                ) : null}
                {issue.recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className={cn(
                      "grid gap-1.5 rounded-lg border p-3",
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
                    <p className="whitespace-pre-wrap text-sm">{rec.body}</p>
                  </div>
                ))}
                <form onSubmit={addRecommendation} className="flex gap-2">
                  <Input
                    value={recommendation}
                    onChange={(e) => setRecommendation(e.target.value)}
                    placeholder="Add a recommendation..."
                    aria-label="Add a recommendation"
                  />
                  <Button type="submit" variant="outline" disabled={addingRec || !recommendation.trim()}>
                    Add
                  </Button>
                </form>
              </div>

              {taskHref || issue.rockId ? (
                <div className="flex flex-wrap gap-4 text-sm">
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

              <Separator />

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setShowTask(true)}>
                  Turn into task
                </Button>
                <Button variant="outline" onClick={() => setShowRock(true)}>
                  Make it a Rock
                </Button>
                {issue.status === "OPEN" ? (
                  <Button onClick={() => patch({ status: "SOLVED" })}>
                    <Check className="size-4" />
                    Mark solved
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => patch({ status: "OPEN" })}>
                    Reopen
                  </Button>
                )}
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="w-fit text-destructive hover:text-destructive"
                onClick={remove}
              >
                <Trash2 className="size-3.5" />
                Remove issue
              </Button>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <IssueToTaskDialog
        open={showTask}
        onOpenChange={setShowTask}
        issueId={issue?.id ?? ""}
        teamMembers={teamMembers}
        onDone={refresh}
      />
      <IssueToRockDialog
        open={showRock}
        onOpenChange={setShowRock}
        issueId={issue?.id ?? ""}
        leadershipMembers={leadershipMembers}
        onDone={refresh}
      />
    </>
  );
}
