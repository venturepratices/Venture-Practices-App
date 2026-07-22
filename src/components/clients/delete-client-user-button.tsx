"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";

import { deleteClientUserAction } from "@/lib/actions/client-users";
import { Button } from "@/components/ui/button";

export function DeleteClientUserButton({ clientUserId, name }: { clientUserId: string; name: string }) {
  const [isPending, startTransition] = useTransition();

  return (
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
  );
}
