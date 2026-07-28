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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type TemplateOption = { id: string; name: string };

export function NewWorkflowDialog({
  trigger,
  templates,
  fixedClientId,
}: {
  trigger: React.ReactElement;
  templates: TemplateOption[];
  fixedClientId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [startBlank, setStartBlank] = useState(templates.length === 0);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function templateName(id: string) {
    return templates.find((t) => t.id === id)?.name ?? "";
  }

  async function handleSubmit() {
    if (!startBlank && !templateId) return;
    if (!name.trim()) return;
    setError(null);
    setIsSaving(true);
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowTemplateId: startBlank ? null : templateId,
        name: name.trim(),
        clientId: fixedClientId,
      }),
    });
    setIsSaving(false);

    if (response.ok) {
      const created = await response.json();
      setOpen(false);
      setName("");
      router.push(fixedClientId ? `/clients/${fixedClientId}/workflows/${created.id}` : `/workflows/${created.id}`);
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't start that workflow.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !name && templateId) setName(templateName(templateId));
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a workflow</DialogTitle>
          <DialogDescription>
            {startBlank ? "Start with no stages — add them yourself once it's running." : "Spawns a real task per template task, grouped into stages."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {templates.length > 0 ? (
            <div className="flex gap-1.5 rounded-lg border p-1">
              <Button
                type="button"
                size="sm"
                variant={startBlank ? "ghost" : "secondary"}
                className="flex-1"
                onClick={() => setStartBlank(false)}
              >
                From template
              </Button>
              <Button
                type="button"
                size="sm"
                variant={startBlank ? "secondary" : "ghost"}
                className="flex-1"
                onClick={() => setStartBlank(true)}
              >
                Start blank
              </Button>
            </div>
          ) : null}

          {startBlank ? (
            <p className="text-sm text-muted-foreground">
              {templates.length === 0
                ? "No templates yet — start blank and add stages/tasks yourself, or create a template in Settings → Workflow Templates first."
                : "No stages to start — you'll add them from the workflow's own page once it's created."}
            </p>
          ) : (
            <div className="space-y-2">
              <Label>Template</Label>
              <Select
                value={templateId}
                onValueChange={(value) => {
                  if (!value) return;
                  setTemplateId(value);
                  if (!name || templates.some((t) => t.name === name)) setName(templateName(value));
                }}
              >
                <SelectTrigger>
                  <SelectValue>{(value: string) => templateName(value) || "Select a template"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="workflow-name">Name</Label>
            <Input
              id="workflow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Onboarding — Journey Smiles"
              required
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={isSaving || (!startBlank && !templateId) || !name.trim()}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            {isSaving ? "Starting..." : "Start workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
