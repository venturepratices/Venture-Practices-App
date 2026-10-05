import { cn, initialsOf } from "@/lib/utils";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";

// Small initials avatar + name, used for "Raised by" and Rock owners.
export function PersonChip({ name, className }: { name: string | null | undefined; className?: string }) {
  if (!name) return <span className={cn("text-sm text-muted-foreground", className)}>—</span>;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-sm", className)}>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
        {initialsOf(name)}
      </span>
      <TruncateTooltip text={name} />
    </span>
  );
}
