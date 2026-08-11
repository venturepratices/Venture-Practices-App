import { cn } from "@/lib/utils"

// Loading-shell convention: give a page's loading.tsx the exact same outer
// shell as the real page, populated with these shapes, so there's no layout
// jump between skeleton and real content.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md bg-[linear-gradient(90deg,var(--muted)_25%,color-mix(in_oklch,var(--muted),white_35%)_50%,var(--muted)_75%)] bg-[length:200%_100%] motion-safe:animate-skeleton-shimmer dark:bg-[linear-gradient(90deg,var(--muted)_25%,color-mix(in_oklch,var(--muted),white_12%)_50%,var(--muted)_75%)]",
        className
      )}
      {...props}
    />
  )
}

function StatCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="size-10 rounded-full" />
      </div>
      <Skeleton className="h-9 w-16" />
    </div>
  )
}

function RowSkeleton({ withAvatar = false }: { withAvatar?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-3">
      {withAvatar && <Skeleton className="size-8 shrink-0 rounded-full" />}
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  )
}

function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <Skeleton className="h-4 w-32" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  )
}

export { Skeleton, StatCardSkeleton, RowSkeleton, CardSkeleton }
