"use client";

import { TrendingDown, TrendingUp } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  METRIC_LABEL,
  NOT_WIRED_METRICS,
  NOT_WIRED_REASON,
  metricHealth,
} from "@/lib/marketing/insights";
import type { MetricKey } from "@/lib/marketing/insights";
import { HealthDot } from "./health-dot";

export const NOT_WIRED_SYMBOL = "—";

function formatValue(value: number, isRate: boolean): string {
  if (isRate) return `${(value * 100).toFixed(1)}%`;
  return Math.round(value).toLocaleString("en-US");
}

/** Flat line when there is no series (or no sends). */
function Sparkline({ series }: { series?: number[] }) {
  const W = 100;
  const H = 18;
  const hasSeries = !!series && series.length > 1 && series.some((v) => v !== 0);
  let points = `0,${H / 2} ${W},${H / 2}`;
  if (hasSeries && series) {
    const max = Math.max(...series);
    const min = Math.min(...series);
    const span = max - min || 1;
    points = series
      .map((v, i) => {
        const x = (i / (series.length - 1)) * W;
        const y = H - 2 - ((v - min) / span) * (H - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-[18px] w-full"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={hasSeries ? "stroke-foreground" : "stroke-muted-foreground/40"}
      />
    </svg>
  );
}

export function MetricTile({
  metricKey,
  value,
  sends,
  isRate = true,
  delta = null,
  series,
}: {
  metricKey: MetricKey;
  value: number;
  sends: number;
  isRate?: boolean;
  delta?: number | null;
  series?: number[];
}) {
  const notWired = NOT_WIRED_METRICS.has(metricKey);
  const health = metricHealth(metricKey, value, sends);
  const reason = NOT_WIRED_REASON[metricKey];
  const noDelta = delta == null || sends === 0;

  let big: React.ReactNode;
  if (notWired) {
    const symbol = (
      <span aria-label="Not wired yet" className="cursor-help">
        {NOT_WIRED_SYMBOL}
      </span>
    );
    big = reason ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              className="inline-flex rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          }
        >
          {symbol}
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    ) : (
      symbol
    );
  } else if (sends === 0) {
    big = <span className="text-base text-muted-foreground">No data yet</span>;
  } else {
    big = formatValue(value, isRate);
  }

  return (
    <Card size="sm" className="gap-2 px-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          {METRIC_LABEL[metricKey]}
        </p>
        <HealthDot health={health} size="sm" />
      </div>
      <p className="text-2xl font-semibold tabular-nums">{big}</p>
      {noDelta ? (
        <p className="text-xs text-muted-foreground">No change</p>
      ) : (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {delta >= 0 ? (
            <TrendingUp aria-hidden className="size-3.5" />
          ) : (
            <TrendingDown aria-hidden className="size-3.5" />
          )}
          <span className="tabular-nums">
            {delta >= 0 ? "+" : "-"}
            {Math.abs(delta).toFixed(1)} pts
          </span>
        </p>
      )}
      <Sparkline series={sends === 0 ? undefined : series} />
    </Card>
  );
}
