"use client";

import { useActionState, useState } from "react";

import {
  createTeamMemberAction,
  updateTeamMemberAction,
  type TeamMemberFormState,
} from "@/lib/actions/team-members";
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

const initialState: TeamMemberFormState = { error: null };

type Props =
  | { mode: "create"; trigger: React.ReactElement }
  | { mode: "edit"; trigger: React.ReactElement; memberId: string; defaultName: string; defaultEmail: string };

export function TeamMemberFormDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const action = props.mode === "create" ? createTeamMemberAction : updateTeamMemberAction.bind(null, props.memberId);
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
            <DialogTitle>{props.mode === "create" ? "New team member" : "Edit team member"}</DialogTitle>
            <DialogDescription>
              {props.mode === "create"
                ? "Create a login for a new team member."
                : "Update this team member's details, or leave password blank to keep it unchanged."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required defaultValue={props.mode === "edit" ? props.defaultName : undefined} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                defaultValue={props.mode === "edit" ? props.defaultEmail : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{props.mode === "create" ? "Temporary password" : "New password"}</Label>
              <Input
                id="password"
                name="password"
                type="text"
                placeholder={props.mode === "edit" ? "Leave blank to keep current password" : undefined}
                required={props.mode === "create"}
              />
            </div>
            {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
