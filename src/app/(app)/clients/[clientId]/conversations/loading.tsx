import { Skeleton } from "@/components/ui/skeleton";

export default function ConversationsLoading() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
      <div className="flex h-[calc(100vh-260px)] min-h-[420px] overflow-hidden rounded-lg border">
        <div className="w-72 shrink-0 border-r p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-2.5 border-b py-2.5 last:border-b-0">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-16 w-2/3 rounded-lg" />
          <Skeleton className="mt-2 ml-auto h-16 w-2/3 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
