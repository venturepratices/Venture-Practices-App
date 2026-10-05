"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { splitBrainDump } from "@/lib/leadership";

// Paste a whole list (notes, a meeting summary, a bulleted email) and every
// line becomes its own issue — bullets and numbering are stripped.
export function BrainDumpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titles = splitBrainDump(text);

  async function save() {
    if (titles.length === 0) return;
    setSaving(true);
    setError(null);
    const response = await fetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles }),
    });
    setSaving(false);
    if (response.ok) {
      setText("");
      onOpenChange(false);
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't add these issues.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Paste brain dump</DialogTitle>
          <DialogDescription>Paste your list — each line becomes its own issue.</DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"- Billing for South Gaston was missed\n- Need a shared team calendar\n- PPC ad copy sounds generic"}
          className="min-h-48 text-sm"
          autoFocus
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || titles.length === 0}>
            {saving
              ? "Adding..."
              : titles.length === 0
                ? "Add issues"
                : `Add ${titles.length} ${titles.length === 1 ? "issue" : "issues"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
