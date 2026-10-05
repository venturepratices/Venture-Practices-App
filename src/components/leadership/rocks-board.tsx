"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Mountain, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/info-tip";
import { PersonChip } from "@/components/leadership/person-chip";
import { RockDialog, type RockFormValues } from "@/components/leadership/rock-dialog";
import { quarterKeyFor, quarterLabel, quarterProgress, ROCK_STATUS_LABELS, shiftQuarter } from "@/lib/leadership";
import { cn, formatDate } from "@/lib/utils";

type RockStatus = keyof typeof ROCK_STATUS_LABELS;

export type RockListItem = {
  id: string;
  title: string;
  doneDefinition: string | null;
  isCompany: boolean;
  status: RockStatus;
  dueDate: string;
  owner: { id: string; name: string } | null;
};

const STATUS_STYLE: Record<RockStatus, string> = {
  ON_TRACK: "bg-emerald-600 text-white",
  OFF_TRACK: "bg-orange-500 text-white",
  DONE: "bg-sky-600 text-white",
};

export function RocksBoard({
  quarter,
  rocks,
  leadershipMembers,
}: {
  quarter: string;
  rocks: RockListItem[];
  leadershipMembers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Optimistic statuses so the segmented control responds instantly.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, RockStatus>>({});
  const [dialogRock, setDialogRock] = useState<RockFormValues | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);

  const isCurrent = quarter === quarterKeyFor();
  const { week, totalWeeks, daysLeft, start, end } = quarterProgress(quarter);
  const statusOf = (rock: RockListItem) => statusOverrides[rock.id] ?? rock.status;
  const counts = { ON_TRACK: 0, OFF_TRACK: 0, DONE: 0 };
  for (const rock of rocks) counts[statusOf(rock)]++;

  function goToQuarter(key: string) {
    router.push(key === quarterKeyFor() ? pathname : `${pathname}?q=${key}`, { scroll: false });
  }

  function openDialog(rock: RockFormValues | null) {
    setDialogRock(rock);
    setDialogKey((k) => k + 1); // fresh form state each time it opens
    setDialogOpen(true);
  }

  async function setStatus(rock: RockListItem, status: RockStatus) {
    setStatusOverrides((prev) => ({ ...prev, [rock.id]: status }));
    const response = await fetch(`/api/rocks/${rock.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setStatusOverrides((prev) => ({ ...prev, [rock.id]: rock.status }));
    }
    router.refresh();
  }

  const sections = [
    { label: "Company Rocks", items: rocks.filter((r) => r.isCompany) },
    { label: "Individual Rocks", items: rocks.filter((r) => !r.isCompany) },
  ].filter((s) => s.items.length > 0);

  const rangeLabel = `${formatDate(start, { month: "short", day: "numeric" })} – ${formatDate(end, { month: "short", day: "numeric" })}`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Rocks
            <InfoTip>
              Rocks are the 3–7 most important things to get done this quarter (90 days). Each one has an owner and a
              clear &quot;Done when&quot;. Every week, the owner marks it On track or Off track — owners get a Slack
              reminder Monday morning, and the team is told when one goes off track.
            </InfoTip>
          </h1>
          <p className="mt-1 text-muted-foreground">
            {quarterLabel(quarter)} · {rangeLabel}
            {isCurrent ? ` · ${daysLeft} days left` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border">
            <Button variant="ghost" size="icon-sm" aria-label="Previous quarter" onClick={() => goToQuarter(shiftQuarter(quarter, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="px-1 text-sm font-medium">{quarterLabel(quarter)}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Next quarter" onClick={() => goToQuarter(shiftQuarter(quarter, 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Button onClick={() => openDialog(null)}>
            <Plus className="size-4" />
            Add Rock
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
        <div className="flex min-w-60 flex-1 items-center gap-3">
          <span className="shrink-0 text-sm font-medium">
            {isCurrent ? `Week ${week} of ${totalWeeks}` : `${totalWeeks} weeks`}
          </span>
          <div className="flex min-w-0 flex-1 gap-1" aria-hidden>
            {Array.from({ length: totalWeeks }, (_, i) => (
              <span
                key={i}
                className={cn("h-1.5 flex-1 rounded-full", isCurrent && i < week ? "bg-primary" : "bg-muted")}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <Legend className="bg-emerald-600" label={`${counts.ON_TRACK} on track`} />
          <Legend className="bg-orange-500" label={`${counts.OFF_TRACK} off track`} />
          <Legend className="bg-sky-600" label={`${counts.DONE} done`} />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-[minmax(0,1fr)_9rem_4.5rem_15.5rem] items-center gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground lg:grid">
          <span>Rock</span>
          <span>Owner</span>
          <span>Due</span>
          <span>This week</span>
        </div>
        {sections.length === 0 ? (
          <EmptyState
            icon={Mountain}
            title={`No Rocks for ${quarterLabel(quarter)} yet.`}
            description="Add the few things that matter most this quarter."
          />
        ) : (
          sections.map((section) => (
            <div key={section.label}>
              <div className="border-b bg-muted/20 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </div>
              {section.items.map((rock) => (
                <div
                  key={rock.id}
                  className="grid gap-3 border-b px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_9rem_4.5rem_15.5rem] lg:items-center lg:gap-4"
                >
                  <button
                    type="button"
                    onClick={() =>
                      openDialog({
                        id: rock.id,
                        title: rock.title,
                        doneDefinition: rock.doneDefinition,
                        ownerId: rock.owner?.id ?? null,
                        isCompany: rock.isCompany,
                        dueDate: rock.dueDate,
                      })
                    }
                    className="min-w-0 text-left"
                  >
                    <span className="block text-sm font-medium hover:underline">{rock.title}</span>
                    {rock.doneDefinition ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">Done when: {rock.doneDefinition}</span>
                    ) : (
                      <span className="mt-0.5 block text-xs text-muted-foreground/70 italic">Add a &quot;Done when&quot;…</span>
                    )}
                  </button>
                  <div className="flex items-center gap-3 lg:contents">
                    <PersonChip name={rock.owner?.name} />
                    <span className="text-sm text-muted-foreground">
                      <span className="lg:hidden">Due </span>
                      {formatDate(rock.dueDate, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 rounded-lg border p-0.5" role="group" aria-label="This week's status">
                    {(Object.keys(ROCK_STATUS_LABELS) as RockStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        aria-pressed={statusOf(rock) === status}
                        onClick={() => statusOf(rock) !== status && setStatus(rock, status)}
                        className={cn(
                          "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
                          statusOf(rock) === status ? STATUS_STYLE[status] : "text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {ROCK_STATUS_LABELS[status]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <RockDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rock={dialogRock}
        quarter={quarter}
        leadershipMembers={leadershipMembers}
      />
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}
