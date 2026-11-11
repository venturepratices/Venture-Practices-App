import { Skeleton } from "@/components/ui/skeleton";

// The same shell as the Insights page (heading, filter row, four card
// skeletons), so nothing jumps when the real charts arrive.
export default function SalesInsightsLoading() {
  return (
    <div aria-busy="true">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <Skeleton className="h-7 w-36" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Skeleton className="h-7 w-[140px] pointer-coarse:h-10" />
        <Skeleton className="h-7 w-[180px] pointer-coarse:h-10" />
        <Skeleton className="h-4 w-[200px] max-w-full" />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 min-[900px]:grid-cols-2">
        {Array.from({ length: 4 }).map((_, card) => (
          <div key={card} className="rounded-[10px] border bg-card">
            <div className="flex items-start justify-between gap-2 border-b px-3.5 py-[11px]">
              <div className="flex-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="mt-2 h-3 w-48 max-w-full" />
              </div>
              <Skeleton className="h-7 w-[70px] pointer-coarse:h-10" />
            </div>
            <div className="flex flex-col gap-2 px-3.5 pt-3">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-3 w-44" />
            </div>
            <div className="px-3.5 pt-3 pb-3">
              <Skeleton className="h-[200px] w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
