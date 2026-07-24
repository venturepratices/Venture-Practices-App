import { cn } from "@/lib/utils";
import type { StatusTone } from "@/components/ui/status-pill";

// Solid, saturated fills (not the pale pill tokens) so segments stay
// visible against the muted track at both small widths and in dark mode.
const TONE_BG: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  neutral: "bg-zinc-400",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  sky: "bg-sky-500",
  slate: "bg-slate-400",
};

/** Proportional stacked bar summarizing counts by status tone. Pure CSS, no charting library. */
export function StatusBar({ segments }: { segments: { tone: StatusTone; count: number }[] }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) {
    return <div className="h-2 w-full rounded-full bg-muted" />;
  }
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      {segments
        .filter((s) => s.count > 0)
        .map((s, i) => (
          <div
            key={i}
            className={cn("h-full", TONE_BG[s.tone])}
            style={{ width: `${(s.count / total) * 100}%` }}
          />
        ))}
    </div>
  );
}
