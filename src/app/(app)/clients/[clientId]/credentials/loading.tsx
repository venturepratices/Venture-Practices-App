import { Skeleton } from "@/components/ui/skeleton";

export default function ClientCredentialsLoading() {
  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
