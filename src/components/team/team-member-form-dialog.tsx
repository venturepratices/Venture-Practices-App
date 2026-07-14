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

type ClientOption = { id: string; name: string };

type EditDefaults = {
  memberId: string;
  defaultName: string;
  defaultEmail: string;
  defaultIsAdmin: boolean;
  defaultAllClientsAccess: boolean;
  defaultCanViewCredentials: boolean;
  defaultCanViewConversations: boolean;
  defaultCanViewActivityArchive: boolean;
  defaultClientIds: string[];
};

type Props =
  | ({ mode: "create"; trigger: React.ReactElement; clients: ClientOption[] })
  | ({ mode: "edit"; trigger: React.ReactElement; clients: ClientOption[] } & EditDefaults);

// A small labeled native checkbox — native (not the Base UI Checkbox) so its
// value is included in the form's FormData submission without extra wiring.
function CheckRow({
  name,
  value,
  label,
  defaultChecked,
  checked,
  onChange,
}: {
  name: string;
  value?: string;
  label: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={onChange ? undefined : defaultChecked}
        checked={checked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        className="size-4 rounded border-input"
      />
      {label}
    </label>
  );
}

export function TeamMemberFormDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const action = props.mode === "create" ? createTeamMemberAction : updateTeamMemberAction.bind(null, props.memberId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  const isEdit = props.mode === "edit";
  const [isAdmin, setIsAdmin] = useState(isEdit ? props.defaultIsAdmin : false);
  const [allClients, setAllClients] = useState(isEdit ? props.defaultAllClientsAccess : false);
  const defaultClientIds = isEdit ? props.defaultClientIds : [];

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
                ? "Create a login and set what this person can access."
                : "Update details and access, or leave password blank to keep it unchanged."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4 pr-1">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required defaultValue={isEdit ? props.defaultName : undefined} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required defaultValue={isEdit ? props.defaultEmail : undefined} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{props.mode === "create" ? "Temporary password" : "New password"}</Label>
              <Input
                id="password"
                name="password"
                type="text"
                placeholder={isEdit ? "Leave blank to keep current password" : undefined}
                required={props.mode === "create"}
              />
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Access</p>
              <CheckRow
                name="isAdmin"
                label="Administrator — full access to everything, manages the team"
                checked={isAdmin}
                onChange={setIsAdmin}
              />

              {!isAdmin ? (
                <div className="space-y-3 border-t pt-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Clients</p>
                    <CheckRow
                      name="allClientsAccess"
                      label="All clients"
                      checked={allClients}
                      onChange={setAllClients}
                    />
                    {!allClients ? (
                      <div className="mt-1 max-h-40 space-y-1.5 overflow-y-auto rounded-md border p-2">
                        {props.clients.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No clients yet.</p>
                        ) : (
                          props.clients.map((client) => (
                            <CheckRow
                              key={client.id}
                              name="clientIds"
                              value={client.id}
                              label={client.name}
                              defaultChecked={defaultClientIds.includes(client.id)}
                            />
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1.5 border-t pt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Sensitive areas
                    </p>
                    <CheckRow
                      name="canViewCredentials"
                      label="Credentials vault"
                      defaultChecked={isEdit ? props.defaultCanViewCredentials : false}
                    />
                    <CheckRow
                      name="canViewConversations"
                      label="Conversations & Calls (HighLevel)"
                      defaultChecked={isEdit ? props.defaultCanViewConversations : false}
                    />
                    <CheckRow
                      name="canViewActivityArchive"
                      label="Activity log & Archive"
                      defaultChecked={isEdit ? props.defaultCanViewActivityArchive : false}
                    />
                  </div>
                </div>
              ) : null}
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
