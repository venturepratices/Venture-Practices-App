"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Member = { id: string; name: string };

/**
 * Which team members to consider — for both the suggested-slots computation
 * and the Available/Busy list. Defaults to everyone (no `members` param).
 */
export function MemberFilter({ members }: { members: Member[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get("members");
  const selected = raw ? new Set(raw.split(",")) : null; // null = everyone

  function apply(next: Set<string>) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.size === members.length) params.delete("members");
    else params.set("members", [...next].join(","));
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function toggle(memberId: string) {
    const current = selected ?? new Set(members.map((m) => m.id));
    const next = new Set(current);
    if (next.has(memberId)) next.delete(memberId);
    else next.add(memberId);
    apply(next);
  }

  const allSelected = !selected || selected.size === members.length;
  const selectedNames = members.filter((m) => (selected ? selected.has(m.id) : true)).map((m) => m.name);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">People:</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="outline" size="sm" className="min-w-40 justify-between font-normal">
              <span className="truncate text-left">{allSelected ? "All people" : selectedNames.join(", ") || "None selected"}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem checked={allSelected} closeOnClick={false} onCheckedChange={() => apply(new Set(members.map((m) => m.id)))}>
            All people
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {members.map((member) => (
            <DropdownMenuCheckboxItem
              key={member.id}
              checked={selected ? selected.has(member.id) : true}
              closeOnClick={false}
              onCheckedChange={() => toggle(member.id)}
            >
              {member.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
