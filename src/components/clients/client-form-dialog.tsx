"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { ClientStatusPill } from "@/components/clients/client-status-pill";

const initialState: ClientFormState = { error: null };

type ClientDefaults = {
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  address: string | null;
  about: string | null;
};

type Props =
  | { mode: "create"; trigger: React.ReactElement }
  | ({ mode: "edit"; trigger: React.ReactElement; clientId: string; defaultName: string; defaultStatus: string } & ClientDefaults);

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
                  <SelectValue>{(status: string) => <ClientStatusPill status={status} />}</SelectValue>
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contactName">Contact name</Label>
                <Input id="contactName" name="contactName" defaultValue={props.mode === "edit" ? props.contactName ?? "" : ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactPhone">Contact phone</Label>
                <Input id="contactPhone" name="contactPhone" defaultValue={props.mode === "edit" ? props.contactPhone ?? "" : ""} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input
                id="contactEmail"
                name="contactEmail"
                type="email"
                defaultValue={props.mode === "edit" ? props.contactEmail ?? "" : ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                name="website"
                placeholder="https://..."
                defaultValue={props.mode === "edit" ? props.website ?? "" : ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" name="address" defaultValue={props.mode === "edit" ? props.address ?? "" : ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="about">About</Label>
              <Textarea
                id="about"
                name="about"
                rows={3}
                placeholder="Anything else worth knowing about this client..."
                defaultValue={props.mode === "edit" ? props.about ?? "" : ""}
              />
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
