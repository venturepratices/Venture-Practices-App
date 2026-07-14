"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CheckCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SearchInput } from "@/components/search-input";

const ALL = "ALL";

const TYPE_LABELS: Record<string, string> = {
  ASSIGNED: "Assigned to you",
  MENTIONED: "Mentioned you",
  STATUS_CHANGED: "Status changed",
  DEADLINE_CHANGED: "Deadline changed",
  COMMENTED: "New comment",
};

const READ_LABELS: Record<string, string> = {
  UNREAD: "Unread",
  READ: "Read",
};

type Props = {
  hasUnread: boolean;
};

export function NotificationFilters({ hasUnread }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isMarkingAll, startMarkingAll] = useTransition();

  const type = searchParams.get("type") ?? ALL;
  const read = searchParams.get("read") ?? ALL;
  const hasFilters =
    [type, read].some((v) => v !== ALL) || Boolean(searchParams.get("q") || searchParams.get("from") || searchParams.get("to"));

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

  function markAllRead() {
    startMarkingAll(async () => {
      await fetch("/api/notifications/mark-all-read", { method: "POST" });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput placeholder="Search notifications..." className="w-64" />

      <Select value={read} onValueChange={(value) => setParam("read", value)}>
        <SelectTrigger className="w-[130px]">
          <SelectValue>{(value: string) => (value === ALL ? "All" : READ_LABELS[value])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {Object.entries(READ_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={type} onValueChange={(value) => setParam("type", value)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue>{(value: string) => (value === ALL ? "All types" : TYPE_LABELS[value])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All types</SelectItem>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
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

      {hasUnread ? (
        <Button variant="outline" size="sm" onClick={markAllRead} disabled={isMarkingAll} className="ml-auto">
          <CheckCheck className="size-3.5" />
          Mark all as read
        </Button>
      ) : null}
    </div>
  );
}
