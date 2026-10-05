"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CircleAlert, ClipboardPaste, MessageSquare, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/info-tip";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { AddIssueDialog } from "@/components/leadership/add-issue-dialog";
import { BrainDumpDialog } from "@/components/leadership/brain-dump-dialog";
import { IssueDetailPanel } from "@/components/leadership/issue-detail-panel";
import { PersonChip } from "@/components/leadership/person-chip";
import { cn, formatDate } from "@/lib/utils";

export type IssueListItem = {
  id: string;
  title: string;
  kind: "PROBLEM" | "SITUATION";
  status: "OPEN" | "SOLVED";
  topRank: number | null;
  client: { id: string; name: string } | null;
  raisedBy: { id: string; name: string } | null;
  recommendationCount: number;
  createdAt: string;
  solvedAt: string | null;
};

type Option = { id: string; name: string };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "mine", label: "Raised by me" },
  { key: "company", label: "Company-wide" },
  { key: "client", label: "Client-related" },
  { key: "watching", label: "Just watching" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export function IssuesBoard({
  issues,
  currentUserId,
  clients,
  teamMembers,
  leadershipMembers,
}: {
  issues: IssueListItem[];
  currentUserId: string | null;
  clients: Option[];
  teamMembers: Option[];
  leadershipMembers: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("issueId");

  const [tab, setTab] = useState<"OPEN" | "SOLVED">("OPEN");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showDump, setShowDump] = useState(false);

  const openCount = issues.filter((i) => i.status === "OPEN").length;
  const solvedCount = issues.length - openCount;

  const visible = useMemo(
    () =>
      issues.filter((issue) => {
        if (issue.status !== tab) return false;
        if (filter === "mine") return issue.raisedBy?.id === currentUserId;
        if (filter === "company") return !issue.client;
        if (filter === "client") return !!issue.client;
        if (filter === "watching") return issue.kind === "SITUATION";
        return true;
      }),
    [issues, tab, filter, currentUserId]
  );

  const topThree = tab === "OPEN" ? visible.filter((i) => i.topRank).sort((a, b) => a.topRank! - b.topRank!) : [];
  const rest = tab === "OPEN" ? visible.filter((i) => !i.topRank) : visible;

  function openIssue(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("issueId", id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Issues List
            <InfoTip>
              Anything on your mind about the business — problems to solve, or situations you&apos;re just keeping an eye
              on. Before each weekly meeting, pick the Top 3 to talk about first. Click an issue to add recommendations,
              mark one as the decision, or turn it into a task or a Rock.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Pick the top 3 to solve at each weekly meeting.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowDump(true)}>
            <ClipboardPaste className="size-4" />
            Paste brain dump
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="size-4" />
            Add issue
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {(["OPEN", "SOLVED"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm font-medium transition-colors",
                tab === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {value === "OPEN" ? "Open" : "Solved"}
              <span className="text-xs opacity-80">{value === "OPEN" ? openCount : solvedCount}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                filter === f.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-[2rem_minmax(0,1fr)_9rem_3.5rem_4.5rem] items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span />
          <span>Issue</span>
          <span>Raised by</span>
          <span>Ideas</span>
          <span>{tab === "SOLVED" ? "Solved" : "Added"}</span>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={CircleAlert}
            title={tab === "OPEN" ? "No open issues here." : "Nothing solved yet."}
            description={tab === "OPEN" ? "Add one, or paste a whole list at once with “Paste brain dump”." : undefined}
          />
        ) : (
          <>
            {topThree.length > 0 ? <SectionLabel>This week&apos;s Top 3</SectionLabel> : null}
            {topThree.map((issue) => (
              <IssueRow key={issue.id} issue={issue} selected={issue.id === selectedId} onOpen={openIssue} />
            ))}
            {topThree.length > 0 && rest.length > 0 ? <SectionLabel>Everything else</SectionLabel> : null}
            {rest.map((issue) => (
              <IssueRow key={issue.id} issue={issue} selected={issue.id === selectedId} onOpen={openIssue} />
            ))}
          </>
        )}
      </div>

      <AddIssueDialog open={showAdd} onOpenChange={setShowAdd} clients={clients} />
      <BrainDumpDialog open={showDump} onOpenChange={setShowDump} />
      <IssueDetailPanel clients={clients} teamMembers={teamMembers} leadershipMembers={leadershipMembers} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b bg-muted/20 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function IssueRow({ issue, selected, onOpen }: { issue: IssueListItem; selected: boolean; onOpen: (id: string) => void }) {
  const date = issue.status === "SOLVED" && issue.solvedAt ? issue.solvedAt : issue.createdAt;
  return (
    <button
      type="button"
      onClick={() => onOpen(issue.id)}
      className={cn(
        "grid w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40 md:grid-cols-[2rem_minmax(0,1fr)_9rem_3.5rem_4.5rem]",
        selected && "bg-primary/5"
      )}
    >
      {issue.topRank ? (
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {issue.topRank}
        </span>
      ) : (
        <span className="size-4 rounded-full border-2 border-muted-foreground/30" />
      )}
      <span className="min-w-0">
        <TruncateTooltip text={issue.title} className="block text-sm font-medium" />
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {issue.client ? (
            <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground/80">{issue.client.name}</span>
          ) : null}
          {issue.kind === "SITUATION" ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
              Just watching
            </span>
          ) : null}
          {/* Phone: the desktop columns are hidden, so their facts ride along here. */}
          <span className="md:hidden">
            {issue.raisedBy?.name ?? "—"} · {issue.recommendationCount} ideas · {formatDate(date, { month: "short", day: "numeric" })}
          </span>
        </span>
      </span>
      <PersonChip name={issue.raisedBy?.name} className="hidden md:flex" />
      <span className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
        <MessageSquare className="size-3.5" />
        {issue.recommendationCount}
      </span>
      <span className="hidden text-sm text-muted-foreground md:block">
        {formatDate(date, { month: "short", day: "numeric" })}
      </span>
    </button>
  );
}
