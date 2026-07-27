"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

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

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function NewProgramDialog({ clientId, trigger }: { clientId: string; trigger: React.ReactElement }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [product, setProduct] = useState<string>("NEW_MOVERS");
  const [startMonth, setStartMonth] = useState("");
  const [lengthMonths, setLengthMonths] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return;
    setError(null);
    setIsSaving(true);
    const response = await fetch("/api/programs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        name: name.trim(),
        product,
        // If left blank, default to the current month rather than blocking
        // creation on a date the user may not have decided yet.
        startMonth: new Date(`${startMonth || currentMonthValue()}-01T00:00:00.000Z`).toISOString(),
        lengthMonths: Number(lengthMonths) || 1,
      }),
    });
    setIsSaving(false);

    if (response.ok) {
      setOpen(false);
      setName("");
      setStartMonth("");
      setLengthMonths("1");
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't create that program.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Direct Mail program</DialogTitle>
          <DialogDescription>Set up a new mail program for this client — you'll add monthly campaigns next.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="program-name">Program name</Label>
            <Input
              id="program-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New Movers — Fall 2026"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="program-product">Product</Label>
            <Select value={product} onValueChange={(value) => value && setProduct(value)}>
              <SelectTrigger id="program-product" className="w-full">
                <SelectValue>{(value: string) => PROGRAM_PRODUCT_LABELS[value] ?? value}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PROGRAM_PRODUCT_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {PROGRAM_PRODUCT_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="program-start">Start month</Label>
              <Input id="program-start" type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
              <p className="text-xs text-muted-foreground">Leave blank to default to the current month.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="program-length">Length (months)</Label>
              <Input
                id="program-length"
                type="number"
                min={1}
                max={36}
                value={lengthMonths}
                onChange={(e) => setLengthMonths(e.target.value)}
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={isSaving || !name.trim()}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            {isSaving ? "Creating..." : "Create program"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
