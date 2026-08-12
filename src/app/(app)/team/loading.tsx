import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function TeamLoading() {
  return (
    <div>
      <Skeleton className="h-7 w-24" />
      <div className="mt-4 flex gap-4 border-b pb-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>
      <div className="mt-4 rounded-lg border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-b px-4 last:border-b-0">
            <RowSkeleton withAvatar />
          </div>
        ))}
      </div>
    </div>
  );
}
