"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

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

export function NewOrderTemplateDialog({ trigger }: { trigger: React.ReactElement }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return;
    setError(null);
    setIsSaving(true);
    const response = await fetch("/api/order-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setIsSaving(false);

    if (response.ok) {
      setOpen(false);
      setName("");
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't create that template.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New order template</DialogTitle>
          <DialogDescription>Starts with no custom fields yet — add fields after creating it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="order-template-name">Template name</Label>
            <Input
              id="order-template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard Retainer"
              required
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={isSaving || !name.trim()}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            {isSaving ? "Creating..." : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
