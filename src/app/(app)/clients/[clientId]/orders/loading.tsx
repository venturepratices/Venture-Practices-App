import { Skeleton } from "@/components/ui/skeleton";

export default function ClientOrdersLoading() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-6 rounded-lg border px-4 py-3">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
      </div>
      <div className="mt-6">
        <Skeleton className="mb-2 h-3 w-28" />
        <div className="rounded-lg border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 border-b px-3 py-2.5 last:border-b-0">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
