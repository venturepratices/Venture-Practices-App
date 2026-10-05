"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CircleAlert, ClipboardPaste, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/info-tip";
import { BrainDumpDialog } from "@/components/leadership/brain-dump-dialog";
import { IssueCard, type IssueCardData } from "@/components/leadership/issue-card";
import { NewIssueForm } from "@/components/leadership/new-issue-form";
import { cn } from "@/lib/utils";

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
  issues: IssueCardData[];
  currentUserId: string | null;
  clients: Option[];
  teamMembers: Option[];
  leadershipMembers: Option[];
}) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"OPEN" | "SOLVED">("OPEN");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showDump, setShowDump] = useState(false);
  const [adding, setAdding] = useState(false);

  // Cards open in place, so more than one can be open at a time. The meeting's
  // #1 issue starts open (it's the one being discussed first); an ?issueId=
  // link opens that one instead, so a deep link still lands somewhere useful.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const linked = searchParams.get("issueId");
    if (linked) return new Set([linked]);
    const top = issues.find((i) => i.status === "OPEN" && i.topRank === 1);
    return new Set(top ? [top.id] : []);
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  const cardProps = { clients, teamMembers, leadershipMembers };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Issues List
            <InfoTip>
              Anything on your mind about the business — problems to solve, or situations you&apos;re just keeping an eye
              on. Before each weekly meeting, pick the Top 3 to talk about first. Click an issue to open it, add
              recommendations, mark one as the decision, or turn it into a task or a Rock.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">Pick the top 3 to solve at each weekly meeting.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowDump(true)}>
            <ClipboardPaste className="size-4" />
            Paste brain dump
          </Button>
          <Button onClick={() => setAdding((open) => !open)}>
            <Plus className="size-4" />
            Add issue
          </Button>
        </div>
      </div>

      {adding ? (
        <div className="mt-4">
          <NewIssueForm clients={clients} onClose={() => setAdding(false)} />
        </div>
      ) : null}

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

      {visible.length === 0 ? (
        <div className="mt-4 rounded-xl border">
          <EmptyState
            icon={CircleAlert}
            title={tab === "OPEN" ? "No open issues here." : "Nothing solved yet."}
            description={tab === "OPEN" ? "Add one, or paste a whole list at once with “Paste brain dump”." : undefined}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-2.5">
          {topThree.length > 0 ? <SectionLabel>This week&apos;s Top 3</SectionLabel> : null}
          {topThree.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              expanded={expanded.has(issue.id)}
              onToggle={() => toggle(issue.id)}
              {...cardProps}
            />
          ))}
          {topThree.length > 0 && rest.length > 0 ? <SectionLabel>Everything else</SectionLabel> : null}
          {rest.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              expanded={expanded.has(issue.id)}
              onToggle={() => toggle(issue.id)}
              {...cardProps}
            />
          ))}
        </div>
      )}

      <BrainDumpDialog open={showDump} onOpenChange={setShowDump} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{children}</p>
  );
}
