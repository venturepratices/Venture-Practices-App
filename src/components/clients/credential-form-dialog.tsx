"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

type Props =
  | { mode: "create"; clientId: string; trigger: React.ReactElement }
  | {
      mode: "edit";
      clientId: string;
      credentialId: string;
      trigger: React.ReactElement;
      defaultLabel: string;
      defaultUrl: string | null;
      defaultUsername: string | null;
    };

export function CredentialFormDialog(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(props.mode === "edit" ? props.defaultLabel : "");
  const [url, setUrl] = useState(props.mode === "edit" ? props.defaultUrl ?? "" : "");
  const [username, setUsername] = useState(props.mode === "edit" ? props.defaultUsername ?? "" : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSaving(true);
    const body = { label: label.trim(), url: url.trim(), username: username.trim(), password: password.trim() };
    const response =
      props.mode === "create"
        ? await fetch(`/api/clients/${props.clientId}/credentials`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/client-credentials/${props.credentialId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
    setIsSaving(false);

    if (response.ok) {
      setOpen(false);
      setPassword("");
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't save that credential.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={props.trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.mode === "create" ? "Add credential" : "Edit credential"}</DialogTitle>
          <DialogDescription>
            {props.mode === "create"
              ? "Store access to a third-party site (e.g. WordPress admin)."
              : "Leave the password blank to keep the existing one."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="cred-label">Label</Label>
            <Input id="cred-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. WordPress Admin" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cred-url">URL</Label>
            <Input id="cred-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cred-username">Username</Label>
            <Input id="cred-username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cred-password">Password{props.mode === "edit" ? " (leave blank to keep current)" : ""}</Label>
            <Input
              id="cred-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={props.mode === "create"}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !label.trim() || (props.mode === "create" && !password.trim())}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
