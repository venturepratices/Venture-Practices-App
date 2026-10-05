"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClientSelect } from "@/components/leadership/client-select";
import { IssueKindToggle } from "@/components/leadership/issue-kind-toggle";

export function AddIssueDialog({
  open,
  onOpenChange,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"PROBLEM" | "SITUATION">("PROBLEM");
  const [clientId, setClientId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setKind("PROBLEM");
    setClientId(null);
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Write what the issue is first.");
      return;
    }
    setSaving(true);
    setError(null);
    const response = await fetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), description: description.trim() || null, kind, clientId }),
    });
    setSaving(false);
    if (response.ok) {
      reset();
      onOpenChange(false);
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't add this issue.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add an issue</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="issue-title">What&apos;s the issue?</Label>
            <Input
              id="issue-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Direct mail went out before the client was billed"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <IssueKindToggle value={kind} onChange={setKind} />
          </div>
          <div className="grid gap-1.5">
            <Label>About</Label>
            <ClientSelect clients={clients} value={clientId} onChange={setClientId} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="issue-description">More detail (optional)</Label>
            <Textarea
              id="issue-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add issue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
