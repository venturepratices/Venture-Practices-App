"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WizardDraft } from "@/components/programs/wizard/wizard-shell";

export function ScheduleStep({
  draft,
  setField,
}: {
  draft: WizardDraft;
  setField: <K extends keyof WizardDraft>(key: K, value: WizardDraft[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="wizard-start">Start month</Label>
          <Input id="wizard-start" type="month" value={draft.startMonth} onChange={(e) => setField("startMonth", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wizard-length">Length (months)</Label>
          <Input
            id="wizard-length"
            type="number"
            min={1}
            max={36}
            value={draft.lengthMonths}
            onChange={(e) => setField("lengthMonths", e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-mail-day">Mail day of month</Label>
        <Input
          id="wizard-mail-day"
          type="number"
          min={1}
          max={28}
          value={draft.mailDayOfMonth}
          onChange={(e) => setField("mailDayOfMonth", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Each campaign's mail date; creative/approval/print due dates auto-compute from it.</p>
      </div>
    </div>
  );
}
