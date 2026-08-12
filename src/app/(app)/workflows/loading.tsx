import { Skeleton } from "@/components/ui/skeleton";

export default function WorkflowsLoading() {
  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Skeleton className="h-7 w-24" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      <div className="mt-6 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="mt-3 h-6 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
