"use client";

import { cn } from "@/lib/utils";

// Problem = something wrong that needs solving; Just watching = a situation
// worth keeping an eye on that isn't a problem yet.
export function IssueKindToggle({
  value,
  onChange,
  disabled,
}: {
  value: "PROBLEM" | "SITUATION";
  onChange: (value: "PROBLEM" | "SITUATION") => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {(
        [
          ["PROBLEM", "Problem"],
          ["SITUATION", "Just watching"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(key)}
          className={cn(
            "rounded-sm px-2.5 py-1 text-sm font-medium transition-colors disabled:opacity-50",
            value === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
