"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WizardDraft } from "@/components/programs/wizard/wizard-shell";

export function DefaultsStep({
  draft,
  setField,
}: {
  draft: WizardDraft;
  setField: <K extends keyof WizardDraft>(key: K, value: WizardDraft[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Applied to every campaign this wizard creates — each is still editable individually afterward.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="wizard-quantity">Quantity</Label>
          <Input id="wizard-quantity" type="number" min={0} value={draft.quantity} onChange={(e) => setField("quantity", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wizard-budget">Budget (USD)</Label>
          <Input id="wizard-budget" type="number" min={0} step="0.01" value={draft.budget} onChange={(e) => setField("budget", e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-geography">Geography</Label>
        <Input id="wizard-geography" value={draft.geography} onChange={(e) => setField("geography", e.target.value)} placeholder="e.g. Zip codes 28202, 28203, 28204" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-offer">Offer</Label>
        <Input id="wizard-offer" value={draft.offer} onChange={(e) => setField("offer", e.target.value)} placeholder="e.g. $50 New Patient Special" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-cta">Call to action</Label>
        <Input id="wizard-cta" value={draft.cta} onChange={(e) => setField("cta", e.target.value)} placeholder="e.g. Call or scan to book" />
      </div>
    </div>
  );
}
