import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";

// The same shell as the Sales dashboard (the greeting with Everyone / Just me,
// four KPI tiles, the forecast, then four boxes of three rows), so nothing
// jumps when the real numbers arrive.
export default function SalesDashboardLoading() {
  return (
    <div aria-busy="true">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <Skeleton className="h-7 w-52" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-[150px] pointer-coarse:h-10" />
      </div>

      <div className="mt-[18px] grid grid-cols-2 gap-3 min-[820px]:grid-cols-4">
        {Array.from({ length: 4 }).map((_, tile) => (
          <div key={tile} className="rounded-[10px] border bg-card px-[15px] py-[13px]">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-6 w-20" />
            <Skeleton className="mt-2 h-3 w-28 max-w-full" />
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 min-[820px]:grid-cols-2">
        <div className="rounded-[10px] border bg-card max-sm:order-3 min-[820px]:col-span-2">
          <div className="border-b px-3.5 py-[11px]">
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, cell) => (
              <div key={cell} className="px-[15px] py-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-2 h-6 w-20" />
              </div>
            ))}
          </div>
        </div>
        {Array.from({ length: 4 }).map((_, box) => (
          <div key={box} className={["rounded-[10px] border bg-card", BOX_ORDER[box]].join(" ")}>
            <div className="border-b px-3.5 py-[11px]">
              <Skeleton className="h-4 w-32" />
            </div>
            {Array.from({ length: 3 }).map((_, row) => (
              <div key={row} className="border-b px-3.5 last:border-b-0">
                <RowSkeleton withAvatar />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Phones show the to-do boxes before the forecast, as the dashboard does. */
const BOX_ORDER = ["max-sm:order-1", "max-sm:order-2", "max-sm:order-4", "max-sm:order-4"];
