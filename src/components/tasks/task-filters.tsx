"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/tasks/status-pill";
import { TASK_OCCURRENCE_VALUES, TASK_STATUS_VALUES } from "@/lib/validations/task";

const ALL = "ALL";
const NO_CLIENT = "NONE";
const UNASSIGNED = "UNASSIGNED";

const OCCURRENCE_LABELS: Record<string, string> = {
  RECURRING_WEEKLY: "Recurring Weekly",
  RECURRING_MONTHLY: "Recurring Monthly",
  RECURRING_QUARTERLY: "Recurring Quarterly",
  PROJECT: "Project",
  NON_RECURRING: "Non Recurring",
};

const DEADLINE_LABELS: Record<string, string> = {
  OVERDUE: "Overdue",
  SOON: "Due in 7 days",
  NONE: "No deadline",
};

export const TASK_FILTER_KEYS = ["status", "clientId", "assigneeId", "occurrence", "deadline"] as const;

type Props = {
  clients: { id: string; name: string }[];
  teamMembers: { id: string; name: string }[];
};

export function TaskFilters({ clients, teamMembers }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = searchParams.get("status") ?? ALL;
  const clientId = searchParams.get("clientId") ?? ALL;
  const assigneeId = searchParams.get("assigneeId") ?? ALL;
  const occurrence = searchParams.get("occurrence") ?? ALL;
  const deadline = searchParams.get("deadline") ?? ALL;

  const activeFilterCount = [status, clientId, assigneeId, occurrence, deadline].filter((v) => v !== ALL).length;

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
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
    <div className="flex flex-wrap items-center gap-2">
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

      <Select value={clientId} onValueChange={(value) => setParam("clientId", value)}>
        <SelectTrigger className="w-[160px]">
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

      <Select value={assigneeId} onValueChange={(value) => setParam("assigneeId", value)}>
        <SelectTrigger className="w-[160px]">
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
        <SelectTrigger className="w-[170px]">
          <SelectValue>{(value: string) => (value === ALL ? "All occurrences" : OCCURRENCE_LABELS[value])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All occurrences</SelectItem>
          {TASK_OCCURRENCE_VALUES.map((o) => (
            <SelectItem key={o} value={o}>
              {OCCURRENCE_LABELS[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={deadline} onValueChange={(value) => setParam("deadline", value)}>
        <SelectTrigger className="w-[150px]">
          <SelectValue>{(value: string) => (value === ALL ? "Any deadline" : DEADLINE_LABELS[value])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any deadline</SelectItem>
          <SelectItem value="OVERDUE">Overdue</SelectItem>
          <SelectItem value="SOON">Due in 7 days</SelectItem>
          <SelectItem value="NONE">No deadline</SelectItem>
        </SelectContent>
      </Select>

      {activeFilterCount > 0 ? (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
