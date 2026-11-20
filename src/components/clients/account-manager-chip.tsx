import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { cn, initialsOf } from "@/lib/utils";

/**
 * A client's account manager as a small avatar and name, or quiet "Not
 * assigned" text (every existing client starts that way, so it must not shout).
 * `detail` is an optional second line under the name (their email on the Info
 * tab).
 */
export function AccountManagerChip({
  name,
  detail,
  size = "sm",
  className,
}: {
  name: string | null;
  detail?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!name) return <span className={cn("text-sm text-muted-foreground", className)}>Not assigned</span>;

  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary",
          size === "md" ? "size-9 text-sm" : "size-7 text-[11px]"
        )}
      >
        {initialsOf(name)}
      </span>
      <span className="min-w-0">
        <TruncateTooltip text={name} className={cn("block", size === "md" ? "font-medium" : undefined)} />
        {detail ? <TruncateTooltip text={detail} className="block text-xs text-muted-foreground" /> : null}
      </span>
    </span>
  );
}
