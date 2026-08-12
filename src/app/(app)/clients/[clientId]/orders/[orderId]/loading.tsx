import { Skeleton } from "@/components/ui/skeleton";

export default function ClientOrderDetailLoading() {
  return (
    <div className="max-w-2xl">
      <Skeleton className="h-4 w-16" />
      <div className="mt-4 rounded-lg border p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-2 h-4 w-32" />
          </div>
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        <Skeleton className="mt-4 h-3 w-56" />
        <div className="mt-6">
          <Skeleton className="h-3 w-20" />
          <div className="mt-2 rounded-lg border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
