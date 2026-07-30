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

export function NewWorkflowTemplateDialog({ trigger }: { trigger: React.ReactElement }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return;
    setError(null);
    setIsSaving(true);
    const response = await fetch("/api/workflow-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Starts with zero stages — unlike Direct Mail's fixed 7-stage pipeline,
      // a Workflow's stages are entirely user-defined, so there's no
      // sensible skeleton to pre-seed. Add stages in the editor after creating.
      body: JSON.stringify({ name: name.trim(), stageTemplates: [] }),
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
          <DialogTitle>New project template</DialogTitle>
          <DialogDescription>Starts with no stages yet — add stages and tasks after creating it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="workflow-template-name">Template name</Label>
            <Input
              id="workflow-template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Client Onboarding"
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
