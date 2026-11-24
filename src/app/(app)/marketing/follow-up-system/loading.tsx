import { Skeleton } from "@/components/ui/skeleton";

// Same shell as the Follow-up system page (title, tab row, one tall card) so
// nothing jumps when the real content arrives.
export default function FollowUpSystemLoading() {
  return (
    <div aria-busy="true">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-28 pointer-coarse:h-10" />
        <Skeleton className="h-8 w-28 pointer-coarse:h-10" />
        <Skeleton className="h-8 w-28 pointer-coarse:h-10" />
      </div>

      <Skeleton className="mt-3 h-[480px] w-full rounded-[10px]" />
    </div>
  );
}
