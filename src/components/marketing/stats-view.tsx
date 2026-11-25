"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, BarChart3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  NOT_WIRED_REASON,
  metricHealth,
  sequenceHealth,
} from "@/lib/marketing/insights";
import type {
  Insights,
  InsightsWindow,
  MetricHealth,
  MetricKey,
} from "@/lib/marketing/insights";
import type {
  Brand,
  Sequence,
  SequenceKey,
  Sequences,
  SequenceStatus,
} from "@/lib/marketing/sequences";
import { HealthDot } from "./health-dot";
import { MetricTile, NOT_WIRED_SYMBOL } from "./metric-tile";
import { StatsWindowToggle } from "./stats-window-toggle";

const BRAND_LABEL: Record<Brand, string> = {
  "venture-practices": "Venture Practices",
  "practice-mailers": "Practice Mailers",
};

const STATUS_LABEL: Record<SequenceStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  "not built": "Not built",
};

const HEALTH_LABEL: Record<MetricHealth, string> = {
  green: "Healthy",
  yellow: "Watch",
  red: "Act",
  "no-data": "No data yet",
  "not-wired": "Not wired",
};

/** Tile order from the Stats spec. */
const TILES: { key: MetricKey; isRate: boolean }[] = [
  { key: "sends", isRate: false },
  { key: "deliveryRate", isRate: true },
  { key: "openRate", isRate: true },
  { key: "clickRate", isRate: true },
  { key: "replyRate", isRate: true },
  { key: "bookingRate", isRate: true },
  { key: "unsubscribeRate", isRate: true },
  { key: "spamComplaintRate", isRate: true },
  { key: "bounceRate", isRate: true },
];

const TH = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const TD = "px-3 py-2.5 text-sm";

function statusVariant(s: SequenceStatus): "outline" | "secondary" | "default" {
  if (s === "active") return "default";
  if (s === "not built") return "secondary";
  return "outline";
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function Banner({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg bg-status-warning px-4 py-3 text-status-warning-foreground"
    >
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{title}</p>
        <p>{body}</p>
      </div>
    </div>
  );
}

function RateCell({
  metric,
  insights,
}: {
  metric: MetricKey;
  insights: Insights;
}) {
  const h = metricHealth(metric, insights[metric], insights.sends);
  const reason = NOT_WIRED_REASON[metric];
  if (h === "not-wired") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              aria-label="Not wired yet"
              className="inline-flex cursor-help rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          }
        >
          {NOT_WIRED_SYMBOL}
        </TooltipTrigger>
        <TooltipContent>{reason ?? "Not wired yet."}</TooltipContent>
      </Tooltip>
    );
  }
  if (insights.sends === 0) {
    return <span className="text-muted-foreground">No data yet</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {pct(insights[metric])}
      <HealthDot health={h} size="sm" />
    </span>
  );
}

function ComparisonTable({
  keys,
  sequences,
  insightsByKey,
}: {
  keys: SequenceKey[];
  sequences: Sequences;
  insightsByKey: Record<SequenceKey, Insights>;
}) {
  const built = keys.filter((k) => sequences[k].status !== "not built");
  return (
    <Card size="lg" className="gap-3 px-0">
      <div className="overflow-x-auto px-5">
        <table role="table" className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>Sequence</th>
              <th scope="col" className={TH}>Status</th>
              <th scope="col" className={cn(TH, "text-right")}>Sends</th>
              <th scope="col" className={TH}>Open rate</th>
              <th scope="col" className={TH}>Click rate</th>
              <th scope="col" className={TH}>Reply rate</th>
              <th scope="col" className={TH}>Unsubscribe</th>
              <th scope="col" className={TH}>Overall</th>
            </tr>
          </thead>
          <tbody>
            {built.map((k) => {
              const s = sequences[k];
              const ins = insightsByKey[k];
              const overall = sequenceHealth(ins);
              return (
                <tr key={k} className="border-b last:border-b-0">
                  <th scope="row" className={cn(TD, "text-left font-medium")}>
                    {s.displayName}
                  </th>
                  <td className={TD}>
                    <Badge variant={statusVariant(s.status)}>
                      {STATUS_LABEL[s.status]}
                    </Badge>
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>
                    {ins.sends.toLocaleString("en-US")}
                  </td>
                  <td className={TD}><RateCell metric="openRate" insights={ins} /></td>
                  <td className={TD}><RateCell metric="clickRate" insights={ins} /></td>
                  <td className={TD}><RateCell metric="replyRate" insights={ins} /></td>
                  <td className={TD}><RateCell metric="unsubscribeRate" insights={ins} /></td>
                  <td className={TD}>
                    <HealthDot health={overall} size="md" label={HEALTH_LABEL[overall]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-5 text-xs text-muted-foreground">
        Thresholds are from the Stats spec. Green means healthy, yellow means
        watch, red means act.
      </p>
    </Card>
  );
}

function PerEmailTable({
  sequence,
  insights,
}: {
  sequence: Sequence;
  insights: Insights;
}) {
  const emails = sequence.steps.flatMap((s) => (s.kind === "email" ? [s] : []));
  return (
    <Card size="lg" className="gap-3 px-0">
      <h3 className="px-5 font-heading text-base font-medium">Per email</h3>
      <div className="overflow-x-auto px-5">
        <table role="table" className="w-full min-w-[480px] border-collapse">
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>Email</th>
              <th scope="col" className={cn(TH, "text-right")}>Opens</th>
              <th scope="col" className={cn(TH, "text-right")}>Clicks</th>
              <th scope="col" className={cn(TH, "text-right")}>Replies</th>
              <th scope="col" className={cn(TH, "text-right")}>Unsubs</th>
            </tr>
          </thead>
          <tbody>
            {emails.map((e, i) => {
              const row = e.templateId ? insights.perEmail[e.templateId] : undefined;
              const rowKey = e.templateId ?? `${sequence.key}-${i}`;
              if (!row || insights.sends === 0) {
                return (
                  <tr key={rowKey} className="border-b last:border-b-0">
                    <td className={cn(TD, "font-medium")}>{e.subject}</td>
                    <td colSpan={4} className={cn(TD, "text-right text-muted-foreground")}>
                      No data yet
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={rowKey} className="border-b last:border-b-0">
                  <td className={cn(TD, "font-medium")}>{e.subject}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.opens}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.clicks}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>
                    <span aria-label="Not wired yet">{NOT_WIRED_SYMBOL}</span>
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.unsubscribes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SequencePanel({
  sequence,
  insights,
}: {
  sequence: Sequence;
  insights: Insights;
}) {
  const overall = sequenceHealth(insights);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="font-heading text-xl font-semibold">{sequence.displayName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{sequence.purpose}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                sequence.brand === "venture-practices" ? "bg-primary" : "bg-secondary-accent",
              )}
            />
            {BRAND_LABEL[sequence.brand]}
          </Badge>
          <Badge variant={statusVariant(sequence.status)}>{STATUS_LABEL[sequence.status]}</Badge>
          <Badge variant="secondary">
            {sequence.flowId === "not built" ? "Not built" : `Flow ${sequence.flowId}`}
          </Badge>
          <HealthDot
            health={overall}
            size="md"
            label={`Overall health: ${HEALTH_LABEL[overall]}`}
          />
        </div>
      </div>

      {sequence.status === "not built" ? (
        <Card size="lg">
          <EmptyState
            icon={BarChart3}
            title="Not built in NitroSend yet. Nothing to measure."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TILES.map((t) => (
              <MetricTile
                key={t.key}
                metricKey={t.key}
                value={insights[t.key]}
                sends={insights.sends}
                isRate={t.isRate}
                delta={null}
              />
            ))}
          </div>
          <PerEmailTable sequence={sequence} insights={insights} />
        </>
      )}
    </div>
  );
}

export function StatsView({
  sequences,
  insightsByKey,
  window,
}: {
  sequences: Sequences;
  insightsByKey: Record<SequenceKey, Insights>;
  window: InsightsWindow;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<SequenceKey | "all">("all");
  const [pendingWindow, setPendingWindow] = useState<InsightsWindow>(window);

  const keys = (Object.keys(sequences) as SequenceKey[]).sort((a, b) =>
    sequences[a].tabNumber.localeCompare(sequences[b].tabNumber),
  );

  function changeWindow(w: InsightsWindow) {
    if (w === pendingWindow) return;
    setPendingWindow(w);
    startTransition(() => {
      router.push(`?window=${w}`);
    });
  }

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  const tabClass = (active: boolean) =>
    cn(
      "relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10",
      active
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  const underline = (
    <span
      aria-hidden
      className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-secondary-accent"
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold">Stats</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How your sequences are performing. Numbers appear once a flow sends
            real emails. Everything shown now is a zero because the flows are
            still in draft.
          </p>
        </div>
        <StatsWindowToggle
          active={pendingWindow}
          pending={isPending}
          onChange={changeWindow}
          onRefresh={refresh}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Banner
          title="Reply rate shows a dash"
          body="Ben hasn't connected Gmail to NitroSend yet. Replies won't count until he does. Reply-stop exits are off too so no one gets stuck."
        />
        <Banner
          title="Booking rate shows a dash"
          body="The GHL appointment-booked workflow is still in Draft. Publish it in GHL to start counting booked calls here."
        />
      </div>

      <div
        role="tablist"
        aria-label="Stats by sequence"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0"
      >
        <button
          type="button"
          role="tab"
          aria-selected={selected === "all"}
          onClick={() => setSelected("all")}
          className={tabClass(selected === "all")}
        >
          <span>All sequences</span>
          {selected === "all" && underline}
        </button>
        {keys.map((key) => {
          const s = sequences[key];
          const active = key === selected;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(key)}
              className={tabClass(active)}
            >
              <span className="font-mono text-xs text-muted-foreground">{s.tabNumber}</span>
              <span>{s.displayName}</span>
              <HealthDot
                health={s.status === "not built" ? "no-data" : sequenceHealth(insightsByKey[key])}
                size="sm"
              />
              {s.status === "not built" && (
                <Badge variant="secondary" className="text-muted-foreground">
                  Not built yet
                </Badge>
              )}
              {active && underline}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {selected === "all" ? (
          <ComparisonTable keys={keys} sequences={sequences} insightsByKey={insightsByKey} />
        ) : (
          <SequencePanel sequence={sequences[selected]} insights={insightsByKey[selected]} />
        )}
      </div>
    </div>
  );
}
