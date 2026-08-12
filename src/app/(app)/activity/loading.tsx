import { Skeleton } from "@/components/ui/skeleton";

export default function ActivityLoading() {
  return (
    <div>
      <Skeleton className="h-7 w-24" />
      <Skeleton className="mt-2 h-4 w-72" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="mt-4 rounded-lg border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
