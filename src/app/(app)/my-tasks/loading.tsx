import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function MyTasksLoading() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-28" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <Skeleton className="h-5 w-20" />
        </CardHeader>
        <CardContent className="p-0">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border-b px-4 last:border-b-0">
              <RowSkeleton />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="mt-4 rounded-lg border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-b px-4 last:border-b-0">
            <RowSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
