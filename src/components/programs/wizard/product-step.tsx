"use client";

import { PROGRAM_PRODUCT_LABELS, PROGRAM_PRODUCT_VALUES } from "@/lib/validations/program";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WizardDraft } from "@/components/programs/wizard/wizard-shell";

const NO_TEMPLATE = "__none__";

export function ProductStep({
  draft,
  setField,
  templates,
}: {
  draft: WizardDraft;
  setField: <K extends keyof WizardDraft>(key: K, value: WizardDraft[K]) => void;
  templates: { id: string; name: string }[];
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Product</Label>
        <Select value={draft.product} onValueChange={(value) => value && setField("product", value)}>
          <SelectTrigger className="w-full">
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

      <div className="space-y-1.5">
        <Label>Template</Label>
        <Select
          value={draft.templateId ?? NO_TEMPLATE}
          onValueChange={(value) => value && setField("templateId", value === NO_TEMPLATE ? null : value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {(value: string) => (value === NO_TEMPLATE ? "No template — blank program" : templates.find((t) => t.id === value)?.name ?? value)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TEMPLATE}>No template — blank program</SelectItem>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The template's stage tasks get spawned into every campaign this wizard creates, with assignees resolved
          from the role bindings step.
        </p>
      </div>
    </div>
  );
}
