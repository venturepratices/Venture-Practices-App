"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SearchInput } from "@/components/search-input";

const ALL = "ALL";

const ENTITY_TYPE_LABELS: Record<string, string> = {
  Task: "Tasks",
  Client: "Clients",
  TeamMember: "Team members",
};

const RANGE_LABELS: Record<string, string> = {
  TODAY: "Today",
  WEEK: "Last 7 days",
  MONTH: "Last 30 days",
};

type Props = {
  teamMembers: { id: string; name: string }[];
};

export function ActivityFilters({ teamMembers }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const actorId = searchParams.get("actorId") ?? ALL;
  const entityType = searchParams.get("entityType") ?? ALL;
  const range = searchParams.get("range") ?? ALL;
  const hasFilters =
    [actorId, entityType, range].some((v) => v !== ALL) ||
    Boolean(searchParams.get("q") || searchParams.get("from") || searchParams.get("to"));

  function setParam(key: string, value: string | null, clearKeys: string[] = []) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL) params.delete(key);
    else params.set(key, value);
    for (const clearKey of clearKeys) params.delete(clearKey);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearAll() {
    router.push(pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput placeholder="Search activity..." className="w-64" />

      <Select value={actorId} onValueChange={(value) => setParam("actorId", value)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue>
            {(value: string) => (value === ALL ? "Everyone" : teamMembers.find((m) => m.id === value)?.name ?? value)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Everyone</SelectItem>
          {teamMembers.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={entityType} onValueChange={(value) => setParam("entityType", value)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue>{(value: string) => (value === ALL ? "All types" : ENTITY_TYPE_LABELS[value])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All types</SelectItem>
          {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={range} onValueChange={(value) => setParam("range", value, ["from", "to"])}>
        <SelectTrigger className="w-[150px]">
          <SelectValue>{(value: string) => (value === ALL ? "Any time" : RANGE_LABELS[value])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any time</SelectItem>
          {Object.entries(RANGE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DateRangeFilter label="Between" fromKey="from" toKey="to" clearKeys={["range"]} />

      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
