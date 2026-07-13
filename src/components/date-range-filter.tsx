"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";

type Props = {
  label: string;
  fromKey: string;
  toKey: string;
  /** Other URL params to clear when a date is picked (e.g. a preset that overlaps this range). */
  clearKeys?: string[];
};

/**
 * "From ... to ..." date pair synced to URL params, so server pages can filter
 * by any custom date range — same pattern as the dropdown filters.
 */
export function DateRangeFilter({ label, fromKey, toKey, clearKeys = [] }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const from = searchParams.get(fromKey) ?? "";
  const to = searchParams.get(toKey) ?? "";

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    for (const clearKey of clearKeys) params.delete(clearKey);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className="whitespace-nowrap text-xs">{label}</span>
      <Input
        type="date"
        value={from}
        onChange={(event) => setParam(fromKey, event.target.value)}
        aria-label={`${label} from date`}
        className="h-8 w-[140px]"
      />
      <span className="text-xs">to</span>
      <Input
        type="date"
        value={to}
        onChange={(event) => setParam(toKey, event.target.value)}
        aria-label={`${label} to date`}
        className="h-8 w-[140px]"
      />
    </div>
  );
}
