"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SearchInput } from "@/components/search-input";

export function MeetingNoteFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hasFilters = Boolean(searchParams.get("q") || searchParams.get("from") || searchParams.get("to"));

  function clearAll() {
    router.push(pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput placeholder="Search meeting notes..." className="w-64" />
      <DateRangeFilter label="Between" fromKey="from" toKey="to" />
      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
