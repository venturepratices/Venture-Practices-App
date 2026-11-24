import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A consistent "read-only, writes happen in the source system" marker shown
 * at the top of any Marketing surface that reflects state we do not own.
 *
 * This is a UI guardrail, not a security boundary — the actual enforcement
 * is that no write endpoints exist for these surfaces. The banner exists so
 * a human looking at the page immediately knows what they can and cannot
 * change here.
 */
export function SafeModeBanner({
  message,
  tone = "default",
}: {
  message: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      role="note"
      aria-label="Read-only notice"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
        tone === "warning"
          ? "border-status-warning-foreground/40 bg-status-warning/10 text-status-warning-foreground"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="leading-relaxed">{message}</p>
    </div>
  );
}
