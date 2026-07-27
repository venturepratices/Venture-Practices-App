"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { CAMPAIGN_STAGE_VALUES } from "@/lib/campaign-stage";
import { PROGRAM_PRODUCT_LABELS, PROGRAM_PRODUCT_VALUES } from "@/lib/validations/program";
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

const NO_PRODUCT = "__any__";

export function NewProgramTemplateDialog({ trigger }: { trigger: React.ReactElement }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [product, setProduct] = useState<string>(NO_PRODUCT);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return;
    setError(null);
    setIsSaving(true);
    const response = await fetch("/api/program-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        product: product === NO_PRODUCT ? null : product,
        // Seed all 7 stages up front (empty task lists) so the editor always
        // shows the full pipeline skeleton to fill in.
        stages: CAMPAIGN_STAGE_VALUES.map((stage) => ({ stage, tasks: [] })),
      }),
    });
    setIsSaving(false);

    if (response.ok) {
      setOpen(false);
      setName("");
      setProduct(NO_PRODUCT);
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
          <DialogTitle>New program template</DialogTitle>
          <DialogDescription>
            Starts with all 7 stages, no tasks yet — add tasks per stage after creating it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="template-name">Template name</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New Movers — Standard"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-product">Product (optional)</Label>
            <Select value={product} onValueChange={(value) => value && setProduct(value)}>
              <SelectTrigger id="template-product" className="w-full">
                <SelectValue>{(value: string) => (value === NO_PRODUCT ? "Any product" : PROGRAM_PRODUCT_LABELS[value] ?? value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRODUCT}>Any product</SelectItem>
                {PROGRAM_PRODUCT_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {PROGRAM_PRODUCT_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
