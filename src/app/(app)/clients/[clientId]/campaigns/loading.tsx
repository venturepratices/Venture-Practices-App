import { Skeleton } from "@/components/ui/skeleton";

export default function ClientCampaignsLoading() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-28" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-40 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>
      <div className="mt-6">
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
      <div className="mt-6 rounded-lg border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
