"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SearchInput } from "@/components/search-input";

const ALL = "ALL";

type Props = {
  teamMembers: { id: string; name: string }[];
};

export function ClientNoteFilters({ teamMembers }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const authorId = searchParams.get("authorId") ?? ALL;
  const hasFilters =
    authorId !== ALL || Boolean(searchParams.get("q") || searchParams.get("from") || searchParams.get("to"));

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL) params.delete(key);
    else params.set(key, value);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearAll() {
    router.push(pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput placeholder="Search notes..." className="w-64" />

      <Select value={authorId} onValueChange={(value) => setParam("authorId", value)}>
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
