import { Skeleton } from "@/components/ui/skeleton";

// The same outer shell as the Deals page (toolbar, then the board filling the
// space under the top bar), so nothing jumps when the real board arrives.
export default function DealsLoading() {
  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] min-w-0 flex-col md:-m-6" aria-busy="true">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3">
        <Skeleton className="h-8 w-40 max-sm:flex-1" />
        <Skeleton className="h-8 w-[66px]" />
        <Skeleton className="h-8 w-[150px]" />
        <Skeleton className="h-8 w-[190px] max-sm:flex-1" />
        <Skeleton className="h-8 w-[72px]" />
      </div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden px-4 pt-2.5 pb-4 max-sm:gap-2.5">
        {Array.from({ length: 5 }).map((_, column) => (
          <div
            key={column}
            className="flex max-w-[300px] flex-[1_0_240px] flex-col rounded-[10px] bg-muted/40 max-sm:max-w-none max-sm:flex-[0_0_84%]"
          >
            <div className="flex flex-col gap-1.5 border-b-2 px-[11px] pt-[11px] pb-2.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex flex-col gap-[7px] p-2">
              {Array.from({ length: 3 }).map((_, card) => (
                <Skeleton key={card} className="h-[72px] rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
