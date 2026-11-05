import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";

// The same shell as the Activities page (header, the day and type filters,
// then the bordered list), so nothing jumps when the real rows arrive.
export default function ActivitiesLoading() {
  return (
    <div aria-busy="true">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-[150px] pointer-coarse:h-10" />
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-[244px] pointer-coarse:h-10" />
        <Skeleton className="h-8 w-[262px] pointer-coarse:h-10" />
      </div>

      <div className="mt-3 rounded-[10px] border">
        {Array.from({ length: 6 }).map((_, row) => (
          <div key={row} className="border-b px-3 last:border-b-0">
            <RowSkeleton withAvatar />
          </div>
        ))}
      </div>
    </div>
  );
}
