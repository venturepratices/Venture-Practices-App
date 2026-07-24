"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";

import { deleteClientUserAction } from "@/lib/actions/client-users";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function DeleteClientUserButton({ clientUserId, name }: { clientUserId: string; name: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${name}`}
              disabled={isPending}
              onClick={() => {
                if (window.confirm(`Remove ${name}'s login? They will lose access immediately.`)) {
                  startTransition(() => deleteClientUserAction(clientUserId));
                }
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Remove login</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
