"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";

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

type EditableCampaign = {
  id: string;
  name: string | null;
  mailDate: Date | string;
  creativeDueDate: Date | string;
  approvalDueDate: Date | string;
  printDueDate: Date | string;
  quantity: number | null;
  geography: string | null;
  budgetCents: number | null;
  offer: string | null;
  cta: string | null;
};

function toDateInputValue(date: Date | string) {
  return new Date(date).toISOString().slice(0, 10);
}

export function EditCampaignDialog({ campaign }: { campaign: EditableCampaign }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(campaign.name ?? "");
  const [mailDate, setMailDate] = useState(toDateInputValue(campaign.mailDate));
  const [creativeDueDate, setCreativeDueDate] = useState(toDateInputValue(campaign.creativeDueDate));
  const [approvalDueDate, setApprovalDueDate] = useState(toDateInputValue(campaign.approvalDueDate));
  const [printDueDate, setPrintDueDate] = useState(toDateInputValue(campaign.printDueDate));
  const [quantity, setQuantity] = useState(campaign.quantity != null ? String(campaign.quantity) : "");
  const [geography, setGeography] = useState(campaign.geography ?? "");
  const [budget, setBudget] = useState(campaign.budgetCents != null ? String(campaign.budgetCents / 100) : "");
  const [offer, setOffer] = useState(campaign.offer ?? "");
  const [cta, setCta] = useState(campaign.cta ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit() {
    if (!mailDate || !creativeDueDate || !approvalDueDate || !printDueDate) return;
    setError(null);
    setIsSaving(true);
    const response = await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || null,
        mailDate: new Date(`${mailDate}T00:00:00.000Z`).toISOString(),
        creativeDueDate: new Date(`${creativeDueDate}T00:00:00.000Z`).toISOString(),
        approvalDueDate: new Date(`${approvalDueDate}T00:00:00.000Z`).toISOString(),
        printDueDate: new Date(`${printDueDate}T00:00:00.000Z`).toISOString(),
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
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't update that campaign.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" size="sm" variant="outline">
            <Pencil className="size-4" />
            Edit
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit campaign</DialogTitle>
          <DialogDescription>Due dates aren't recomputed automatically once edited directly.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-campaign-name">Name</Label>
            <Input
              id="edit-campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Campaign #… — leave blank to show the number`}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-campaign-mail-date">Mail date</Label>
              <Input id="edit-campaign-mail-date" type="date" value={mailDate} onChange={(e) => setMailDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-campaign-creative-due">Creative due</Label>
              <Input
                id="edit-campaign-creative-due"
                type="date"
                value={creativeDueDate}
                onChange={(e) => setCreativeDueDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-campaign-approval-due">Approval due</Label>
              <Input
                id="edit-campaign-approval-due"
                type="date"
                value={approvalDueDate}
                onChange={(e) => setApprovalDueDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-campaign-print-due">Print due</Label>
              <Input
                id="edit-campaign-print-due"
                type="date"
                value={printDueDate}
                onChange={(e) => setPrintDueDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-campaign-quantity">Quantity</Label>
              <Input id="edit-campaign-quantity" type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-campaign-budget">Budget (USD)</Label>
              <Input id="edit-campaign-budget" type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-campaign-geography">Geography</Label>
            <Input id="edit-campaign-geography" value={geography} onChange={(e) => setGeography(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-campaign-offer">Offer</Label>
              <Input id="edit-campaign-offer" value={offer} onChange={(e) => setOffer(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-campaign-cta">Call to action</Label>
              <Input id="edit-campaign-cta" value={cta} onChange={(e) => setCta(e.target.value)} />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !mailDate || !creativeDueDate || !approvalDueDate || !printDueDate}
          >
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
