"use client";

import { cn } from "@/lib/utils";
import type { MetricHealth } from "@/lib/marketing/insights";

const TONE: Record<MetricHealth, string> = {
  green:
    "bg-status-success text-status-success-foreground border-status-success-foreground",
  yellow:
    "bg-status-warning text-status-warning-foreground border-status-warning-foreground",
  red: "bg-status-danger text-status-danger-foreground border-status-danger-foreground",
  "no-data": "bg-muted text-muted-foreground border-muted-foreground/40",
  "not-wired":
    "bg-muted text-muted-foreground border-muted-foreground/40 opacity-60",
};

const STATE_NAME: Record<MetricHealth, string> = {
  green: "green dot, healthy",
  yellow: "yellow dot, watch",
  red: "red dot, needs action",
  "no-data": "grey dot, no data yet",
  "not-wired": "grey dot, not wired yet",
};

export function HealthDot({
  health,
  size = "sm",
  label,
}: {
  health: MetricHealth;
  size?: "sm" | "md";
  label?: string;
}) {
  const dot = (
    <span
      aria-hidden={label ? true : undefined}
      role={label ? undefined : "img"}
      aria-label={label ? undefined : STATE_NAME[health]}
      className={cn(
        "inline-block shrink-0 rounded-full border",
        size === "md" ? "size-3" : "size-2.5",
        TONE[health],
      )}
    />
  );

  if (!label) return dot;

  return (
    <span
      role="img"
      aria-label={`${STATE_NAME[health]}. ${label}`}
      className="inline-flex items-center gap-1.5"
    >
      {dot}
      <span aria-hidden className="text-sm">
        {label}
      </span>
    </span>
  );
}
