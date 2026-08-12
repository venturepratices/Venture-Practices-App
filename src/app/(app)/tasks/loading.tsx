import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";

// Mirrors the real page's shell: header + view toggle, filter bar, then a
// list of rows — List is the default view, so that's what the skeleton
// stands in for.
export default function TasksLoading() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Skeleton className="h-9 w-full sm:w-64" />
        <Skeleton className="h-9 w-full sm:w-[150px]" />
        <Skeleton className="h-9 w-full sm:w-[160px]" />
        <Skeleton className="h-9 w-full sm:w-[160px]" />
      </div>

      <div className="mt-4 rounded-lg border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-b px-1.5 last:border-b-0">
            <RowSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
