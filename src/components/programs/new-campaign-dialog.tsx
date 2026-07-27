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

export function NewCampaignDialog({ clientId, trigger }: { clientId: string; trigger: React.ReactElement }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mailDate, setMailDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [geography, setGeography] = useState("");
  const [budget, setBudget] = useState("");
  const [offer, setOffer] = useState("");
  const [cta, setCta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function reset() {
    setName("");
    setMailDate("");
    setQuantity("");
    setGeography("");
    setBudget("");
    setOffer("");
    setCta("");
  }

  async function handleSubmit() {
    setError(null);
    setIsSaving(true);
    const response = await fetch(`/api/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        name: name.trim() || null,
        mailDate: mailDate ? new Date(`${mailDate}T00:00:00.000Z`).toISOString() : null,
        quantity: quantity ? Number(quantity) : null,
        geography: geography.trim() || null,
        budgetCents: budget ? Math.round(Number(budget) * 100) : null,
        offer: offer.trim() || null,
        cta: cta.trim() || null,
      }),
    });
    setIsSaving(false);

    if (response.ok) {
      setOpen(false);
      reset();
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't add that campaign.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Creative, approval, and print due dates are computed automatically from the mail date (4/3/2 weeks out).
            Leave dates blank to fill in later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="campaign-name">Name (optional)</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. July Mailer — leave blank for &quot;Campaign #N&quot;"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-mail-date">Mail date</Label>
            <Input id="campaign-mail-date" type="date" value={mailDate} onChange={(e) => setMailDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="campaign-quantity">Quantity</Label>
              <Input id="campaign-quantity" type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign-budget">Budget (USD)</Label>
              <Input id="campaign-budget" type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-geography">Geography</Label>
            <Input
              id="campaign-geography"
              value={geography}
              onChange={(e) => setGeography(e.target.value)}
              placeholder="e.g. 5-mile radius, ZIP 90210"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="campaign-offer">Offer</Label>
              <Input id="campaign-offer" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. $50 new-patient exam" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign-cta">Call to action</Label>
              <Input id="campaign-cta" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="e.g. Call to book" />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            {isSaving ? "Adding..." : "Add campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
