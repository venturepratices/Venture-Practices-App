"use client";

import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type TeamMemberOption = { id: string; name: string };

// Multi-select replacing the single-assignee Select across the task UI.
// A dropdown of checkboxes (stays open across toggles) rather than a Select,
// since Base UI's Select has no built-in multi-value mode.
export function TaskAssigneesPicker({
  teamMembers,
  value,
  onChange,
  disabled,
  triggerClassName,
}: {
  teamMembers: TeamMemberOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  triggerClassName?: string;
}) {
  const selectedNames = teamMembers.filter((m) => value.includes(m.id)).map((m) => m.name);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("w-full justify-between font-normal", triggerClassName)}
          >
            <span className="truncate text-left">{selectedNames.length > 0 ? selectedNames.join(", ") : "Unassigned"}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        {teamMembers.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">No team members</p>
        ) : (
          teamMembers.map((member) => (
            <DropdownMenuCheckboxItem
              key={member.id}
              checked={value.includes(member.id)}
              closeOnClick={false}
              onCheckedChange={() => toggle(member.id)}
            >
              {member.name}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
