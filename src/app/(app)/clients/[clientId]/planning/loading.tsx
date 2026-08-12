import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function PlanningLoading() {
  return (
    <div>
      <Skeleton className="h-6 w-24" />
      <div className="mt-4 flex gap-4 border-b pb-2">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-32" />
      </div>
      <Skeleton className="mt-4 h-9 w-full rounded-md" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="mt-4 flex flex-col gap-4 md:flex-row">
        <div className="hidden w-[180px] shrink-0 md:block">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
        </div>
        <div className="min-w-0 flex-1 rounded-lg border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border-b px-4 last:border-b-0">
              <RowSkeleton />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
