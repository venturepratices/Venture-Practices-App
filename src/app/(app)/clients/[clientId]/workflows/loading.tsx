import { Skeleton } from "@/components/ui/skeleton";

export default function ClientWorkflowsLoading() {
  return (
    <div className="-m-6 flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[200px] shrink-0 border-r p-3 md:block">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
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
    </div>
  );
}
