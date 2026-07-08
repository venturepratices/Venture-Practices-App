"use client";

import { useActionState, useState } from "react";

import { createClientAction, updateClientAction, type ClientFormState } from "@/lib/actions/clients";
import { CLIENT_STATUS_VALUES } from "@/lib/validations/client";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientStatusPill } from "@/components/clients/client-status-pill";

const initialState: ClientFormState = { error: null };

type Props =
  | { mode: "create"; trigger: React.ReactElement }
  | { mode: "edit"; trigger: React.ReactElement; clientId: string; defaultName: string; defaultStatus: string };

export function ClientFormDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const action = props.mode === "create" ? createClientAction : updateClientAction.bind(null, props.clientId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <DialogTrigger render={props.trigger} />
      <DialogContent>
        <form
          action={async (formData) => {
            await formAction(formData);
            setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.mode === "create" ? "New client" : "Edit client"}</DialogTitle>
            <DialogDescription>
              {props.mode === "create"
                ? "Add a new client sub-account to the agency."
                : "Update this client's name or status."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Client name</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={props.mode === "edit" ? props.defaultName : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue={props.mode === "edit" ? props.defaultStatus : "ONBOARDING"}>
                <SelectTrigger id="status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_STATUS_VALUES.map((status) => (
                    <SelectItem key={status} value={status}>
                      <ClientStatusPill status={status} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
