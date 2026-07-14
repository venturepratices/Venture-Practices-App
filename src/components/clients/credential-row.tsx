"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";

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
import { CredentialFormDialog } from "@/components/clients/credential-form-dialog";

type Credential = {
  id: string;
  clientId: string;
  label: string;
  url: string | null;
  username: string | null;
};

export function CredentialRow({
  credential,
  canManage = false,
  canReveal = false,
}: {
  credential: Credential;
  canManage?: boolean;
  canReveal?: boolean;
}) {
  const router = useRouter();
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [enteredPassword, setEnteredPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  async function submitReveal() {
    if (!enteredPassword) return;
    setError(null);
    setIsChecking(true);
    const response = await fetch(`/api/client-credentials/${credential.id}/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: enteredPassword }),
    });
    setIsChecking(false);
    if (response.ok) {
      const data = await response.json();
      setRevealedPassword(data.password);
      setRevealOpen(false);
      setEnteredPassword("");
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't reveal password.");
    }
  }

  function hide() {
    setRevealedPassword(null);
  }

  async function copy() {
    if (revealedPassword) await navigator.clipboard.writeText(revealedPassword);
  }

  async function handleDelete() {
    if (!window.confirm(`Delete the credential "${credential.label}"? This can't be undone.`)) return;
    const response = await fetch(`/api/client-credentials/${credential.id}`, { method: "DELETE" });
    if (response.ok) router.refresh();
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{credential.label}</p>
        {credential.url ? (
          <a
            href={credential.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-xs text-primary underline-offset-4 hover:underline"
          >
            {credential.url}
          </a>
        ) : null}
        {credential.username ? <p className="text-xs text-muted-foreground">{credential.username}</p> : null}
        <div className="flex items-center gap-2 pt-1">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{revealedPassword ?? "••••••••"}</code>
          {revealedPassword ? (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="Copy password" onClick={copy}>
                <Copy className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Hide password" onClick={hide}>
                <EyeOff className="size-3.5" />
              </Button>
            </>
          ) : canReveal ? (
            <Dialog
              open={revealOpen}
              onOpenChange={(next) => {
                setRevealOpen(next);
                if (!next) {
                  setEnteredPassword("");
                  setError(null);
                }
              }}
            >
              <DialogTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={`Reveal password for ${credential.label}`}>
                    <Eye className="size-3.5" />
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm your password</DialogTitle>
                  <DialogDescription>Re-enter your own account password to view this credential.</DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor={`reveal-${credential.id}`}>Your password</Label>
                  <Input
                    id={`reveal-${credential.id}`}
                    type="password"
                    value={enteredPassword}
                    onChange={(e) => setEnteredPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitReveal();
                    }}
                    autoFocus
                  />
                  {error ? <p className="text-sm text-destructive">{error}</p> : null}
                </div>
                <DialogFooter>
                  <Button onClick={submitReveal} disabled={isChecking || !enteredPassword}>
                    {isChecking ? "Checking..." : "Reveal"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>
      {canManage ? (
        <div className="flex shrink-0 items-center gap-1">
          <CredentialFormDialog
            mode="edit"
            clientId={credential.clientId}
            credentialId={credential.id}
            defaultLabel={credential.label}
            defaultUrl={credential.url}
            defaultUsername={credential.username}
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${credential.label}`}>
                <Pencil className="size-3.5" />
              </Button>
            }
          />
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${credential.label}`} onClick={handleDelete}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
