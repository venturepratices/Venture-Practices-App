"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";

import { deleteTeamMemberAction } from "@/lib/actions/team-members";
import { Button } from "@/components/ui/button";

export function DeleteTeamMemberButton({ memberId, memberName }: { memberId: string; memberName: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Remove ${memberName}`}
      disabled={isPending}
      onClick={() => {
        if (window.confirm(`Remove ${memberName} from the team? They will lose access immediately.`)) {
          startTransition(() => deleteTeamMemberAction(memberId));
        }
      }}
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
