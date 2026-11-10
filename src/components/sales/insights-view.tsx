"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useOptimistic, useTransition, type ReactNode } from "react";

import { formatMoney } from "@/lib/sales/format";
import type { InsightsData } from "@/lib/sales/insights";
import {
  INSIGHTS_RANGES,
  averageCycleDays,
  cycleLabel,
  monthLabel,
  monthLong,
  rangeWords,
} from "@/lib/sales/insights-client";
import { insightsQueryToSearch, type InsightsQuery, type InsightsRange } from "@/lib/sales/insights-query";
import { pageRendered } from "@/lib/sales/panel-url";
import { cn } from "@/lib/utils";
import { SEGMENT, SEGMENT_GROUP } from "@/components/sales/deals-toolbar";
import {
  ChartCard,
  HorizontalBars,
  MonthColumns,
  MonthLine,
} from "@/components/sales/insights-charts";

// The Sales Insights page on the client (Mockup v2 `viewInsights`): four cards
// in a one-column grid under 900px and two-column above, all sharing the same
// filters (range, Everyone / Just me, funnel pipeline). Every filter change
// goes through router.replace so the URL stays in sync and pressing Back
// restores the view. Each card has an sr-only screen-reader table that reads
// the same numbers as the chart; the Table toggle lives in the chart itself
// (insights-charts.tsx).

/** The muted grey a caption uses, in both themes. */
const CAPTION = "text-[12px] text-muted-foreground";

/** "deal" / "deals" for N. */
function dealWord(n: number): string {
  return n === 1 ? "deal" : "deals";
}

export function InsightsView({ data, now: nowIso }: { data: InsightsData; now: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // The pressed scope and range: the server's, or the ones just asked for
  // while it loads, so a click shows at once.
  const [scope, setScope] = useOptimistic(data.query.scope);
  const [range, setRange] = useOptimistic(data.query.range);
  const [pipelineKey, setPipelineKey] = useOptimistic(data.query.pipeline ?? data.pipeline?.key ?? null);
  // Each render from the server carries its own time: a new one means the
  // charts are fresh, so panel focus state can be cleared.
  useEffect(() => pageRendered(), [nowIso]);

  function navigate(patch: Partial<InsightsQuery>) {
    const next: InsightsQuery = {
      range,
      scope,
      pipeline: pipelineKey,
      ...patch,
    };
    const search = insightsQueryToSearch(next);
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  function changeScope(next: InsightsQuery["scope"]) {
    if (next === scope) return;
    startTransition(() => {
      setScope(next);
      navigate({ scope: next });
    });
  }

  function changeRange(next: InsightsRange) {
    if (next === range) return;
    startTransition(() => {
      setRange(next);
      navigate({ range: next });
    });
  }

  function changePipeline(next: string) {
    if (next === pipelineKey) return;
    startTransition(() => {
      setPipelineKey(next);
      navigate({ pipeline: next });
    });
  }

  const isMine = scope === "mine" || !data.canSeeEveryone;
  const mineWord = isMine ? " of yours" : "";
  const words = rangeWords(range);
  const pipeline = data.pipeline;

  // --- Funnel ---
  const funnelCount = data.funnel.reduce((sum, row) => sum + row.count, 0);
  const funnelValueCents = data.funnel.reduce((sum, row) => sum + row.valueCents, 0);

  const funnelPicker = (
    <select
      aria-label="Pipeline for the funnel"
      value={pipelineKey ?? pipeline?.key ?? ""}
      onChange={(event) => changePipeline(event.target.value)}
      className="inline-flex h-7 items-center rounded-md border bg-card px-2 text-[12.5px] font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-10"
    >
      {data.pipelines.map((option) => (
        <option key={option.id} value={option.key}>
          {option.name}
        </option>
      ))}
    </select>
  );

  // --- Won per month ---
  const wonSumCents = data.wonByMonth.reduce((sum, row) => sum + row.valueCents, 0);
  const wonCount = data.wonByMonth.reduce((sum, row) => sum + row.count, 0);

  // --- Cycle ---
  const avg = averageCycleDays(data.cycleByMonth);

  // --- Activities ---
  const actCount = data.activitiesByPerson.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div className="min-w-0">
          <h1 className="m-0 text-[21px] font-semibold">Insights</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">What closed, how fast, and where open deals sit.</p>
        </div>
      </div>

      <div
        role="group"
        aria-label="Filters for every chart"
        className="mt-3.5 flex flex-wrap items-center gap-2"
      >
        <select
          aria-label="Date range"
          value={String(range)}
          onChange={(event) => changeRange(Number(event.target.value) as InsightsRange)}
          className="inline-flex h-7 items-center rounded-md border bg-card px-2 text-[12.5px] font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-10"
        >
          {INSIGHTS_RANGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {data.canSeeEveryone ? (
          <div role="group" aria-label="Whose numbers" className={SEGMENT_GROUP}>
            <button type="button" aria-pressed={scope === "everyone"} onClick={() => changeScope("everyone")} className={SEGMENT}>
              Everyone
            </button>
            <button type="button" aria-pressed={scope === "mine"} onClick={() => changeScope("mine")} className={SEGMENT}>
              Just me
            </button>
          </div>
        ) : null}
        <span className={cn("text-[12.5px]", CAPTION)}>Sales and Consulting pipelines</span>
      </div>

      {data.capped ? (
        <p className={cn("mt-2 text-[12.5px]", CAPTION)}>Showing the first 5,000 won deals in this range.</p>
      ) : null}

      <div
        aria-busy={pending}
        className={cn(
          "mt-3 grid grid-cols-1 gap-3 min-[900px]:grid-cols-2",
          "transition-opacity duration-200",
          pending && "opacity-60 motion-reduce:opacity-80",
        )}
      >
        <ChartCard
          id="funnel"
          title="Pipeline funnel"
          sub="Open deals in each stage right now"
          tools={funnelPicker}
          headline={
            <>
              <b className="text-[22px] leading-tight font-semibold tabular-nums">{funnelCount}</b>
              <span className={CAPTION}>
                open deals{mineWord} · {formatMoney(funnelValueCents)}
              </span>
            </>
          }
          chart={
            <HorizontalBars
              rows={data.funnel.map((row) => ({
                key: row.stageId,
                label: row.name,
                value: (
                  <>
                    <b className="font-semibold">{row.count}</b>{" "}
                    <small className={CAPTION}>{formatMoney(row.valueCents)}</small>
                  </>
                ),
                count: row.count,
                ariaLabel: `${row.name}: ${row.count} ${dealWord(row.count)}, ${formatMoney(row.valueCents)}`,
              }))}
            />
          }
          table={
            <Table
              caption={`Open deals per stage in ${pipeline?.name ?? ""}`}
              headers={["Stage", "Open deals", "Value"]}
              rows={data.funnel.map((row) => [row.name, String(row.count), formatMoney(row.valueCents)])}
            />
          }
          empty={
            funnelCount === 0 && data.funnel.length === 0 && pipeline
              ? {
                  title: `No open deals${mineWord} in ${pipeline.name}.`,
                  body: "Open deals show here, stage by stage, as they move along.",
                  action: { label: "Open the board", href: "/sales/deals" },
                }
              : undefined
          }
        />

        <ChartCard
          id="won"
          title="Deals won over time"
          sub="Won value per month"
          headline={
            <>
              <b className="text-[22px] leading-tight font-semibold tabular-nums">{formatMoney(wonSumCents)}</b>
              <span className={CAPTION}>
                won in {words} · {wonCount} {dealWord(wonCount)}
              </span>
            </>
          }
          chart={
            <MonthColumns
              rows={data.wonByMonth.map((row, i) => ({
                month: row.month,
                label: monthLabel(row.month),
                long: monthLong(row.month, false),
                current: i === data.wonByMonth.length - 1,
                valueCents: row.valueCents,
                count: row.count,
              }))}
            />
          }
          table={
            <Table
              caption={`Deals won per month, ${words}`}
              headers={["Month", "Won value", "Deals"]}
              rows={data.wonByMonth.map((row, i) => [
                monthLong(row.month, i === data.wonByMonth.length - 1),
                formatMoney(row.valueCents),
                String(row.count),
              ])}
            />
          }
          empty={
            wonSumCents === 0 && wonCount === 0
              ? {
                  title: `No deals${mineWord} won in ${words}.`,
                  body: "Each month's won value shows here once a deal is marked won.",
                  action: { label: "Open the board", href: "/sales/deals" },
                }
              : undefined
          }
        />

        <ChartCard
          id="cycle"
          title="Average deal cycle time"
          sub="Days from created to won, by month won"
          headline={
            <>
              <b className="text-[22px] leading-tight font-semibold tabular-nums">{cycleLabel(avg)}</b>
              <span className={CAPTION}>on average in {words}</span>
            </>
          }
          chart={
            <MonthLine
              rows={data.cycleByMonth.map((row, i) => ({
                month: row.month,
                label: monthLabel(row.month),
                long: monthLong(row.month, false),
                current: i === data.cycleByMonth.length - 1,
                days: row.avgDays,
                count: row.count,
              }))}
            />
          }
          table={
            <Table
              caption={`Average days from created to won, ${words}`}
              headers={["Month", "Average days", "Deals won"]}
              rows={data.cycleByMonth.map((row, i) => [
                monthLong(row.month, i === data.cycleByMonth.length - 1),
                row.avgDays === null ? "No wins" : String(row.avgDays),
                String(row.count),
              ])}
            />
          }
          empty={
            avg === null
              ? {
                  title: "Nothing won yet in this range.",
                  body: "The average number of days from a new deal to a win shows here.",
                  action: { label: "Open the board", href: "/sales/deals" },
                }
              : undefined
          }
        />

        <ChartCard
          id="activities"
          title="Activities completed per person"
          sub="Calls, meetings, tasks and emails marked done"
          headline={
            <>
              <b className="text-[22px] leading-tight font-semibold tabular-nums">{actCount}</b>
              <span className={CAPTION}>
                done in {words}
              </span>
            </>
          }
          chart={
            <HorizontalBars
              rows={data.activitiesByPerson.map((row) => ({
                key: row.ownerId,
                label: row.name,
                value: <b className="font-semibold">{row.count}</b>,
                count: row.count,
                ariaLabel: `${row.name}: ${row.count} done`,
              }))}
            />
          }
          table={
            <Table
              caption={`Activities completed per person, ${words}`}
              headers={["Person", "Activities done"]}
              rows={data.activitiesByPerson.map((row) => [row.name, String(row.count)])}
            />
          }
          empty={
            actCount === 0
              ? {
                  title: `No activities marked done in ${words}.`,
                  body: "Calls, meetings and tasks count here once someone marks them done.",
                  action: { label: "Open activities", href: "/sales/activities" },
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

/** A screen-reader table: caption, header row, body rows (first cell as row header). */
function Table({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <caption className="pb-1.5 text-left text-[12px] font-semibold text-muted-foreground">{caption}</caption>
      <thead>
        <tr>
          {headers.map((header, i) => (
            <th key={header} scope="col" className={cn("border-b px-2 py-1.5 text-left font-semibold", i > 0 && "text-right")}>
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={headers.length} className="px-2 py-1.5 text-muted-foreground">
              Nothing to show.
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <ReactNodeCell key={j} cell={cell} index={j} />
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function ReactNodeCell({ cell, index }: { cell: string; index: number }): ReactNode {
  if (index === 0) {
    return (
      <th scope="row" className="border-b px-2 py-1.5 text-left font-medium">
        {cell}
      </th>
    );
  }
  return (
    <td className="border-b px-2 py-1.5 text-right tabular-nums">{cell}</td>
  );
}
