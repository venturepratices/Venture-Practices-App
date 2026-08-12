import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function ClientNotesLoading() {
  return (
    <div>
      <Skeleton className="h-6 w-16" />
      <Skeleton className="mt-4 h-20 w-full rounded-md" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="mt-4 rounded-lg border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-b px-4 last:border-b-0">
            <RowSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
