"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  createClientUserAction,
  updateClientUserAction,
  type ClientUserFormState,
} from "@/lib/actions/client-users";
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

const initialState: ClientUserFormState = { error: null };

type Props =
  | { mode: "create"; clientId: string; trigger: React.ReactElement }
  | {
      mode: "edit";
      clientUserId: string;
      defaultName: string;
      defaultEmail: string;
      trigger: React.ReactElement;
    };

/** Create/edit a real client-login account — same shape as TeamMemberFormDialog, minus the permission checklist (a client user's access is just "their own client", not configurable). */
export function ClientUserFormDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const action =
    props.mode === "create"
      ? createClientUserAction.bind(null, props.clientId)
      : updateClientUserAction.bind(null, props.clientUserId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={props.trigger} />
      <DialogContent>
        <form
          action={async (formData) => {
            await formAction(formData);
            setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.mode === "create" ? "New client login" : "Edit client login"}</DialogTitle>
            <DialogDescription>
              {props.mode === "create"
                ? "Give this client contact their own login so they can review assets without a share link."
                : "Update details, or leave password blank to keep it unchanged."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cu-name">Name</Label>
              <Input id="cu-name" name="name" required defaultValue={props.mode === "edit" ? props.defaultName : undefined} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cu-email">Email</Label>
              <Input
                id="cu-email"
                name="email"
                type="email"
                required
                defaultValue={props.mode === "edit" ? props.defaultEmail : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cu-password">{props.mode === "create" ? "Temporary password" : "New password"}</Label>
              <Input
                id="cu-password"
                name="password"
                type="text"
                placeholder={props.mode === "edit" ? "Leave blank to keep current password" : undefined}
                required={props.mode === "create"}
              />
              <p className="text-xs text-muted-foreground">
                They&apos;ll be asked to set their own password the first time they log in.
              </p>
            </div>
            {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
