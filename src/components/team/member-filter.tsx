"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Checkbox } from "@/components/ui/checkbox";

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

  function toggle(memberId: string) {
    const current = selected ?? new Set(members.map((m) => m.id));
    const next = new Set(current);
    if (next.has(memberId)) next.delete(memberId);
    else next.add(memberId);

    const params = new URLSearchParams(searchParams.toString());
    if (next.size === members.length) params.delete("members");
    else params.set("members", [...next].join(","));
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="text-xs text-muted-foreground">People:</span>
      {members.map((member) => {
        const checked = selected ? selected.has(member.id) : true;
        return (
          <label key={member.id} className="flex items-center gap-1.5 text-sm">
            <Checkbox checked={checked} onCheckedChange={() => toggle(member.id)} />
            {member.name}
          </label>
        );
      })}
    </div>
  );
}
