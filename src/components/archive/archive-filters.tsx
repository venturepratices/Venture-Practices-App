"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangeFilter } from "@/components/date-range-filter";
import { StatusPill } from "@/components/tasks/status-pill";
import { SearchInput } from "@/components/search-input";
import { TASK_STATUS_VALUES } from "@/lib/validations/task";

const ALL = "ALL";
const INTERNAL = "INTERNAL";

type Props = {
  clientNames: string[];
  teamMembers: { id: string; name: string }[];
};

export function ArchiveFilters({ clientNames, teamMembers }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = searchParams.get("status") ?? ALL;
  const clientName = searchParams.get("clientName") ?? ALL;
  const deletedById = searchParams.get("deletedById") ?? ALL;
  const hasFilters =
    [status, clientName, deletedById].some((v) => v !== ALL) ||
    Boolean(searchParams.get("q") || searchParams.get("deletedFrom") || searchParams.get("deletedTo"));

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
      <SearchInput placeholder="Search archived tasks..." className="w-64" />

      <Select value={status} onValueChange={(value) => setParam("status", value)}>
        <SelectTrigger className="w-[150px]">
          <SelectValue>{(value: string) => (value === ALL ? "All statuses" : <StatusPill status={value} />)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {TASK_STATUS_VALUES.map((s) => (
            <SelectItem key={s} value={s}>
              <StatusPill status={s} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={clientName} onValueChange={(value) => setParam("clientName", value)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue>
            {(value: string) => {
              if (value === ALL) return "All clients";
              if (value === INTERNAL) return "Internal / Agency";
              return value;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All clients</SelectItem>
          <SelectItem value={INTERNAL}>Internal / Agency</SelectItem>
          {clientNames.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={deletedById} onValueChange={(value) => setParam("deletedById", value)}>
        <SelectTrigger className="w-[170px]">
          <SelectValue>
            {(value: string) =>
              value === ALL ? "Deleted by anyone" : `Deleted by ${teamMembers.find((m) => m.id === value)?.name ?? value}`
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Deleted by anyone</SelectItem>
          {teamMembers.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DateRangeFilter label="Deleted between" fromKey="deletedFrom" toKey="deletedTo" />

      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
