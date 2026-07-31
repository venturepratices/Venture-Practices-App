"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SearchInput } from "@/components/search-input";
import { PlanningStatusPill } from "@/components/planning/planning-status-pill";

const ALL = "ALL";

/**
 * Filter bar for the Planning tab's "Ideas" view — same searchParams-driven
 * recipe as ClientNoteFilters/ActivityFilters. Status filter only offers
 * Idea/Strategy since Archive and Converted are their own separate tabs now.
 */
export function PlanningFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = searchParams.get("status") ?? ALL;
  const hasFilters = status !== ALL || Boolean(searchParams.get("q") || searchParams.get("from") || searchParams.get("to"));

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL) params.delete(key);
    else params.set(key, value);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString());
    // Preserve tab/folder selection — only clear the filter-specific params.
    params.delete("q");
    params.delete("status");
    params.delete("from");
    params.delete("to");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput placeholder="Search ideas..." className="w-full sm:w-64" />

      <Select value={status} onValueChange={(value) => setParam("status", value)}>
        <SelectTrigger className="w-full sm:w-[150px]">
          <SelectValue>{(value: string) => (value === ALL ? "Any status" : <PlanningStatusPill status={value} />)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any status</SelectItem>
          <SelectItem value="IDEA">Idea</SelectItem>
          <SelectItem value="STRATEGY">Strategy</SelectItem>
        </SelectContent>
      </Select>

      <DateRangeFilter label="Added" fromKey="from" toKey="to" />

      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
