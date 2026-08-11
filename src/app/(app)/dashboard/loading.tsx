import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CardSkeleton, RowSkeleton, Skeleton, StatCardSkeleton } from "@/components/ui/skeleton";

// Mirrors the real Dashboard page's shell exactly (space-y-6 -> header ->
// 3-up stat grid -> status widget -> due-soon list) so there's no layout
// jump when real data arrives.
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      <CardSkeleton lines={2} />

      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent className="divide-y p-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4">
              <RowSkeleton />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
