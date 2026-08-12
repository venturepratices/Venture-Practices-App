import { Skeleton } from "@/components/ui/skeleton";

export default function CampaignDetailLoading() {
  return (
    <div className="max-w-3xl">
      <Skeleton className="h-4 w-24" />
      <div className="mt-2 flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="mt-4 rounded-lg border p-4">
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-1 h-4 w-20" />
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-1 h-16 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
