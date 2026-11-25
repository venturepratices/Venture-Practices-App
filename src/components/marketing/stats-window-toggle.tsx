"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InsightsWindow } from "@/lib/marketing/insights";

const OPTIONS: { value: InsightsWindow; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

export function StatsWindowToggle({
  active,
  pending,
  onChange,
  onRefresh,
}: {
  active: InsightsWindow;
  pending: boolean;
  onChange: (w: InsightsWindow) => void;
  onRefresh: () => void;
}) {
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown")
      next = (i + 1) % OPTIONS.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + OPTIONS.length) % OPTIONS.length;
    if (next < 0) return;
    e.preventDefault();
    onChange(OPTIONS[next].value);
    const sibling = e.currentTarget.parentElement?.children[next];
    if (sibling instanceof HTMLElement) sibling.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Time window"
        className="inline-flex rounded-lg bg-muted p-0.5"
      >
        {OPTIONS.map((o, i) => {
          const checked = o.value === active;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10",
                checked
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                checked && pending && "animate-pulse",
              )}
            >
              {o.label}
              {checked && pending && <span className="sr-only"> Loading</span>}
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        className="text-muted-foreground pointer-coarse:min-h-10"
      >
        <RefreshCw aria-hidden />
        Refresh now
      </Button>
    </div>
  );
}
