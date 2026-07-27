"use client";

import { PROGRAM_PRODUCT_LABELS } from "@/lib/validations/program";
import type { WizardDraft } from "@/components/programs/wizard/wizard-shell";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function ReviewStep({
  draft,
  templateName,
  teamMemberName,
}: {
  draft: WizardDraft;
  templateName: string;
  teamMemberName: (id: string | null) => string;
}) {
  return (
    <div className="space-y-1 rounded-md border p-3">
      <Row label="Program" value={draft.name || "—"} />
      <Row label="Product" value={PROGRAM_PRODUCT_LABELS[draft.product] ?? draft.product} />
      <Row label="Template" value={templateName} />
      <Row label="Start month" value={draft.startMonth || "—"} />
      <Row label="Campaigns to create" value={String(Number(draft.lengthMonths) || 0)} />
      <Row label="Mail day of month" value={String(draft.mailDayOfMonth)} />
      <Row label="Account Manager" value={teamMemberName(draft.accountManagerId)} />
      <Row label="Creative" value={teamMemberName(draft.creativeId)} />
      <Row label="Production" value={teamMemberName(draft.productionId)} />
    </div>
  );
}
