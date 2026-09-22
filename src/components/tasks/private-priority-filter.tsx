"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PriorityPill } from "@/components/tasks/priority-pill";
import type { PriorityLevelOptionLite } from "@/lib/task-status-utils";
import { resolvePriorityLevelOption } from "@/lib/task-status-utils";

const ALL = "ALL";
const NO_PRIORITY = "NONE";

// Same ?priorityLevelId= param key and ALL/NONE convention as TaskFilters,
// just standalone — the rest of that bar (client, assignee, occurrence...)
// doesn't apply to a private task, so this is the one filter worth having here.
export function PrivatePriorityFilter({ priorityLevelOptions }: { priorityLevelOptions: PriorityLevelOptionLite[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get("priorityLevelId") ?? ALL;

  function setValue(next: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!next || next === ALL) {
      params.delete("priorityLevelId");
    } else {
      params.set("priorityLevelId", next);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger className="h-8 w-full sm:w-[150px]">
        <SelectValue>
          {(v: string) =>
            v === ALL ? (
              "All priorities"
            ) : v === NO_PRIORITY ? (
              "No priority"
            ) : (
              <PriorityPill option={resolvePriorityLevelOption(priorityLevelOptions, v) ?? { label: v, color: "#71717a" }} />
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All priorities</SelectItem>
        <SelectItem value={NO_PRIORITY}>No priority</SelectItem>
        {priorityLevelOptions.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            <PriorityPill option={option} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
