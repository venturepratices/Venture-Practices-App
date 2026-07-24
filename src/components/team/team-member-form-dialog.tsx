"use client";

import { useActionState, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";

import {
  createTeamMemberAction,
  updateTeamMemberAction,
  type TeamMemberFormState,
} from "@/lib/actions/team-members";
import { BASIC_MEMBER_CAPABILITIES, PERMISSION_GROUPS, type Capability } from "@/lib/permission-catalog";
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

const ALL_FALSE_CAPS: Record<Capability, boolean> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => [i.key, false]))
) as Record<Capability, boolean>;

type ClientOption = { id: string; name: string };

type EditDefaults = {
  memberId: string;
  defaultName: string;
  defaultEmail: string;
  defaultIsAdmin: boolean;
  defaultAllClientsAccess: boolean;
  defaultCaps: Record<Capability, boolean>;
  defaultClientIds: string[];
};

type Props =
  | ({ mode: "create"; trigger: React.ReactElement; clients: ClientOption[] })
  | ({ mode: "edit"; trigger: React.ReactElement; clients: ClientOption[] } & EditDefaults);

export function TeamMemberFormDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const action = props.mode === "create" ? createTeamMemberAction : updateTeamMemberAction.bind(null, props.memberId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  const isEdit = props.mode === "edit";
  const [isAdmin, setIsAdmin] = useState(isEdit ? props.defaultIsAdmin : false);
  const [allClients, setAllClients] = useState(isEdit ? props.defaultAllClientsAccess : false);
  const [caps, setCaps] = useState<Record<Capability, boolean>>(isEdit ? props.defaultCaps : ALL_FALSE_CAPS);
  const defaultClientIds = isEdit ? props.defaultClientIds : [];

  function toggleCap(key: Capability, checked: boolean) {
    setCaps((prev) => ({ ...prev, [key]: checked }));
  }

  function applyBasicMemberPreset() {
    setCaps((prev) => {
      const next = { ...prev };
      for (const key of BASIC_MEMBER_CAPABILITIES) next[key] = true;
      return next;
    });
  }

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
                ? "Create a login and check exactly what this person can access."
                : "Update details and access, or leave password blank to keep it unchanged."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto py-4 pr-1">
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
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name="isAdmin"
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                  className="size-4 rounded border-input"
                />
                Administrator — full access to everything, manages the team
              </label>

              {!isAdmin ? (
                <div className="space-y-4 border-t pt-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Clients</p>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="allClientsAccess"
                        checked={allClients}
                        onChange={(e) => setAllClients(e.target.checked)}
                        className="size-4 rounded border-input"
                      />
                      All clients
                    </label>
                    {!allClients ? (
                      <div className="mt-1 max-h-32 space-y-1.5 overflow-y-auto rounded-md border p-2">
                        {props.clients.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No clients yet.</p>
                        ) : (
                          props.clients.map((client) => (
                            <label key={client.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                name="clientIds"
                                value={client.id}
                                defaultChecked={defaultClientIds.includes(client.id)}
                                className="size-4 rounded border-input"
                              />
                              {client.name}
                            </label>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between border-t pt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Permissions</p>
                    <Button type="button" variant="outline" size="sm" onClick={applyBasicMemberPreset}>
                      <Wand2 className="mr-1.5 size-3.5" />
                      Full member access
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {PERMISSION_GROUPS.map((group) => (
                      <div key={group.title} className="space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground">{group.title}</p>
                        <div className="space-y-1 pl-1">
                          {group.items.map((item) => (
                            <label key={item.key} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                name={item.key}
                                checked={caps[item.key]}
                                onChange={(e) => toggleCap(item.key, e.target.checked)}
                                className="size-4 rounded border-input"
                              />
                              {item.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
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
