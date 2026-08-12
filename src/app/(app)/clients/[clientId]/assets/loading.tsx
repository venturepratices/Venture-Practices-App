import { Skeleton } from "@/components/ui/skeleton";

export default function ClientAssetsLoading() {
  return (
    <div className="-m-6 flex h-full flex-col">
      <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
        <div>
          <Skeleton className="h-6 w-20" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[220px] shrink-0 border-r p-3 md:block">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <Skeleton className="h-9 w-full rounded-md" />
          <div className="rounded-lg border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
                <Skeleton className="size-12 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
