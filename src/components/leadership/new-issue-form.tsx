"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ClientSelect } from "@/components/leadership/client-select";
import { IssueKindToggle } from "@/components/leadership/issue-kind-toggle";

/**
 * Inline "add an issue" card, opened from the header button — the same shape
 * as Planning's NewPlanningItemForm, so adding an issue feels like adding an
 * idea rather than opening a modal.
 */
export function NewIssueForm({
  clients,
  onClose,
}: {
  clients: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"PROBLEM" | "SITUATION">("PROBLEM");
  const [clientId, setClientId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
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
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't add this issue.");
      return;
    }
    // Stays open and clears, so a run of issues can be typed one after another.
    setTitle("");
    setDescription("");
    setKind("PROBLEM");
    setClientId(null);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-muted/30 p-3">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        placeholder="What's the issue?"
        disabled={saving}
      />
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Add more detail (optional)..."
        className="min-h-16 text-sm"
        disabled={saving}
      />
      <div className="flex flex-wrap items-center gap-3">
        <IssueKindToggle value={kind} onChange={setKind} disabled={saving} />
        <ClientSelect clients={clients} value={clientId} onChange={setClientId} disabled={saving} />
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Done
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Adding..." : "Add issue"}
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
