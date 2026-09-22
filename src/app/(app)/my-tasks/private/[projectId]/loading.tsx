import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function PrivateProjectDetailLoading() {
  return (
    <div>
      <Skeleton className="h-4 w-16" />
      <Skeleton className="mt-3 h-9 w-64 rounded-md" />
      <Card className="mt-4">
        <CardContent className="p-0">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border-b px-4 last:border-b-0">
              <RowSkeleton />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
