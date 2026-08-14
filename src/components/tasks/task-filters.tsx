"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SearchInput } from "@/components/search-input";
import { KindPill } from "@/components/tasks/kind-pill";
import { StatusPill } from "@/components/tasks/status-pill";
import { TASK_KIND_VALUES, TASK_OCCURRENCE_LABELS, TASK_OCCURRENCE_VALUES } from "@/lib/validations/task";
import type { StatusOptionLite } from "@/lib/task-status-utils";
import { resolveStatusOption } from "@/lib/task-status-utils";

const ALL = "ALL";
const NO_CLIENT = "NONE";
const UNASSIGNED = "UNASSIGNED";

const DEADLINE_LABELS: Record<string, string> = {
  OVERDUE: "Overdue",
  TODAY: "Due today",
  SOON: "Due in 7 days",
  NONE: "No deadline",
};

export const TASK_FILTER_KEYS = [
  "status",
  "clientId",
  "assigneeId",
  "occurrence",
  "kind",
  "deadline",
  "deadlineFrom",
  "deadlineTo",
  // Not a dropdown — set by the "Open tasks" stat card on a client's Tasks
  // tab. Listed here so "Clear filters" clears it too, otherwise the card
  // would stay stuck on with no visible control to switch it off.
  "open",
] as const;

type Props = {
  clients: { id: string; name: string }[];
  teamMembers: { id: string; name: string }[];
  statusOptions?: StatusOptionLite[];
  /** Set on a single client's Tasks tab, where a client dropdown would list exactly one option. */
  hideClientFilter?: boolean;
  searchPlaceholder?: string;
};

export function TaskFilters({
  clients,
  teamMembers,
  statusOptions = [],
  hideClientFilter = false,
  searchPlaceholder = "Search tasks...",
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = searchParams.get("status") ?? ALL;
  const clientId = searchParams.get("clientId") ?? ALL;
  const assigneeId = searchParams.get("assigneeId") ?? ALL;
  const occurrence = searchParams.get("occurrence") ?? ALL;
  const kind = searchParams.get("kind") ?? ALL;
  const deadline = searchParams.get("deadline") ?? ALL;

  const activeFilterCount =
    [status, clientId, assigneeId, occurrence, kind, deadline].filter((v) => v !== ALL).length +
    (searchParams.get("deadlineFrom") || searchParams.get("deadlineTo") ? 1 : 0) +
    // Counted so "Clear filters" appears when a stat card is the only thing
    // filtering — otherwise there'd be no way to switch it off from the bar.
    (searchParams.get("open") ? 1 : 0);

  function setParam(key: string, value: string | null, clearKeys: string[] = []) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    for (const clearKey of clearKeys) params.delete(clearKey);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of TASK_FILTER_KEYS) params.delete(key);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-col flex-wrap gap-2 sm:flex-row sm:items-center">
      <SearchInput placeholder={searchPlaceholder} className="w-full sm:w-64" />

      {/* Picking a specific status clears `open` — the where-builder lets an
          explicit status outrank it, so leaving it set would keep the "Open
          tasks" card looking active while having no effect. */}
      <Select value={status} onValueChange={(value) => setParam("status", value, ["open"])}>
        <SelectTrigger className="w-full sm:w-[150px]">
          <SelectValue>
            {(value: string) => (value === ALL ? "All statuses" : <StatusPill option={resolveStatusOption(statusOptions, value)} />)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {statusOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              <StatusPill option={option} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hideClientFilter ? null : (
        <Select value={clientId} onValueChange={(value) => setParam("clientId", value)}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue>
              {(value: string) => {
                if (value === ALL) return "All clients";
                if (value === NO_CLIENT) return "Internal / Agency";
                return clients.find((c) => c.id === value)?.name ?? value;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All clients</SelectItem>
            <SelectItem value={NO_CLIENT}>Internal / Agency</SelectItem>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={assigneeId} onValueChange={(value) => setParam("assigneeId", value)}>
        <SelectTrigger className="w-full sm:w-[160px]">
          <SelectValue>
            {(value: string) => {
              if (value === ALL) return "All assignees";
              if (value === UNASSIGNED) return "Unassigned";
              return teamMembers.find((m) => m.id === value)?.name ?? value;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All assignees</SelectItem>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {teamMembers.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={occurrence} onValueChange={(value) => setParam("occurrence", value)}>
        <SelectTrigger className="w-full sm:w-[170px]">
          <SelectValue>{(value: string) => (value === ALL ? "All occurrences" : TASK_OCCURRENCE_LABELS[value])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All occurrences</SelectItem>
          {TASK_OCCURRENCE_VALUES.map((o) => (
            <SelectItem key={o} value={o}>
              {TASK_OCCURRENCE_LABELS[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={deadline} onValueChange={(value) => setParam("deadline", value, ["deadlineFrom", "deadlineTo"])}>
        <SelectTrigger className="w-full sm:w-[150px]">
          <SelectValue>{(value: string) => (value === ALL ? "Any deadline" : DEADLINE_LABELS[value])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any deadline</SelectItem>
          <SelectItem value="OVERDUE">Overdue</SelectItem>
          <SelectItem value="TODAY">Due today</SelectItem>
          <SelectItem value="SOON">Due in 7 days</SelectItem>
          <SelectItem value="NONE">No deadline</SelectItem>
        </SelectContent>
      </Select>

      <Select value={kind} onValueChange={(value) => setParam("kind", value)}>
        <SelectTrigger className="w-full sm:w-[150px]">
          <SelectValue>{(value: string) => (value === ALL ? "Related to: All" : <KindPill kind={value} />)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Related to: All</SelectItem>
          {TASK_KIND_VALUES.map((k) => (
            <SelectItem key={k} value={k}>
              <KindPill kind={k} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DateRangeFilter label="Due between" fromKey="deadlineFrom" toKey="deadlineTo" clearKeys={["deadline"]} />

      {activeFilterCount > 0 ? (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
