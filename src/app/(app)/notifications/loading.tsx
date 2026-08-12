import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div>
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="mt-4 rounded-lg border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-b px-4 last:border-b-0">
            <RowSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
