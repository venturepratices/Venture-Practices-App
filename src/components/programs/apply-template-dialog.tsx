"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ApplyTemplateDialog({ campaignId, templates }: { campaignId: string; templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  async function handleApply() {
    if (!templateId) return;
    setError(null);
    setIsApplying(true);
    const response = await fetch(`/api/campaigns/${campaignId}/apply-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    setIsApplying(false);

    if (response.ok) {
      setOpen(false);
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't apply that template.");
    }
  }

  if (templates.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" size="sm">
            <Sparkles className="size-4" />
            Apply template
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply a task template</DialogTitle>
          <DialogDescription>
            Spawns every stage task from the chosen template into this campaign, unassigned — assign people to tasks
            afterward from the campaign page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select value={templateId ?? ""} onValueChange={(v) => v && setTemplateId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => templates.find((t) => t.id === v)?.name ?? "Choose a template"}</SelectValue>
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
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleApply} disabled={isApplying || !templateId}>
            {isApplying ? <Loader2 className="size-4 animate-spin" /> : null}
            {isApplying ? "Applying..." : "Apply template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
