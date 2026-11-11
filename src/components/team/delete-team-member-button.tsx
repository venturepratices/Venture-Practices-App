"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteTeamMemberAction } from "@/lib/actions/team-members";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function DeleteTeamMemberButton({ memberId, memberName }: { memberId: string; memberName: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${memberName}`}
              disabled={isPending}
              onClick={() => {
                if (window.confirm(`Remove ${memberName} from the team? They will lose access immediately.`)) {
                  // A refusal (the only admin, or they still own Sales records) comes back as a message.
                  startTransition(async () => {
                    const { error } = await deleteTeamMemberAction(memberId);
                    if (error) toast.error(error);
                  });
                }
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Remove from team</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
