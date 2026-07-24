"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SearchInput } from "@/components/search-input";
import { AssetStatusPill } from "@/components/assets/asset-status-pill";

const ALL = "ALL";

// ARCHIVED is deliberately excluded — that's the sidebar's "Archived" entry,
// not a status you filter for within the active views, so there's only ever
// one way to reach the archive.
const STATUS_VALUES = ["DRAFT", "IN_REVIEW", "APPROVED", "CHANGES_REQUESTED"] as const;

const KIND_LABELS: Record<string, string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  PDF: "PDF",
  WEBSITE: "Website",
  OTHER: "Other",
};

type Props = {
  teamMembers: { id: string; name: string }[];
};

export function AssetFilters({ teamMembers }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = searchParams.get("status") ?? ALL;
  const kind = searchParams.get("kind") ?? ALL;
  const reviewerId = searchParams.get("reviewerId") ?? ALL;
  const hasFilters =
    [status, kind, reviewerId].some((v) => v !== ALL) ||
    Boolean(searchParams.get("q") || searchParams.get("dueFrom") || searchParams.get("dueTo"));

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL) params.delete(key);
    else params.set(key, value);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearAll() {
    // Keep folder/archive selection — "Clear filters" resets search/status/
    // kind/reviewer/date, not which folder you're looking at.
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["q", "status", "kind", "reviewerId", "dueFrom", "dueTo"]) params.delete(key);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-1 flex-col flex-wrap gap-2 sm:flex-row sm:items-center">
      <SearchInput placeholder="Search assets..." className="w-full sm:w-64" />

      <Select value={status} onValueChange={(value) => setParam("status", value)}>
        <SelectTrigger className="w-full sm:w-[150px]">
          <SelectValue>
            {(value: string) =>
              (STATUS_VALUES as readonly string[]).includes(value) ? <AssetStatusPill status={value} /> : "All statuses"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {STATUS_VALUES.map((s) => (
            <SelectItem key={s} value={s}>
              <AssetStatusPill status={s} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={kind} onValueChange={(value) => setParam("kind", value)}>
        <SelectTrigger className="w-full sm:w-[140px]">
          <SelectValue>{(value: string) => (value === ALL ? "All formats" : KIND_LABELS[value])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All formats</SelectItem>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={reviewerId} onValueChange={(value) => setParam("reviewerId", value)}>
        <SelectTrigger className="w-full sm:w-[170px]">
          <SelectValue>
            {(value: string) => (value === ALL ? "Any reviewer" : teamMembers.find((m) => m.id === value)?.name ?? value)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any reviewer</SelectItem>
          {teamMembers.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DateRangeFilter label="Due between" fromKey="dueFrom" toKey="dueTo" />

      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
