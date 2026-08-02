"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The single most destructive action in the app — permanently deletes a
 * Client and every piece of its own data (assets, workflows, campaigns,
 * notes, credentials, etc.). Requires typing the client's exact current name
 * to confirm, on top of the server route's own capability gate and automatic
 * pre-delete backup. This extra friction is deliberate: a plain confirm()
 * dialog isn't enough resistance for an action this irreversible.
 */
export function DeleteClientDialog({ clientId, clientName }: { clientId: string; clientName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = confirmText === clientName && !isDeleting;

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    const response = await fetch(`/api/clients/${clientId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: confirmText }),
    });
    if (response.ok) {
      router.push("/clients");
      router.refresh();
      return;
    }
    const data = await response.json().catch(() => null);
    setError(data?.error ?? "Couldn't delete this client.");
    setIsDeleting(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setConfirmText("");
          setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="text-destructive">
            <Trash2 className="size-4" />
            Delete client
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &quot;{clientName}&quot;?</DialogTitle>
          <DialogDescription>
            This permanently deletes this client and everything attached to it — notes, meeting notes, links,
            credentials, assets, workflows, campaigns, orders, planning ideas, HighLevel connection, and portal
            logins. Tasks tied to this client are kept but become unattached (internal), matching how the rest of
            the app already treats a removed client/assignee. This cannot be undone from the app — a full database
            backup is taken automatically right before the delete, restorable only by someone with direct database
            access.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="confirm-client-name">
            Type <span className="font-semibold">{clientName}</span> to confirm
          </Label>
          <Input
            id="confirm-client-name"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            autoComplete="off"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={!canSubmit}>
            {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Permanently delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
