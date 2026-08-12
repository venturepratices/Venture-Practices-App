"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WizardDraft } from "@/components/programs/wizard/wizard-shell";

const NO_TEMPLATE = "__none__";

export function TemplateStep({
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
        <Label>Template</Label>
        <Select
          value={draft.templateId ?? NO_TEMPLATE}
          onValueChange={(value) => value && setField("templateId", value === NO_TEMPLATE ? null : value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {(value: string) => (value === NO_TEMPLATE ? "No template — blank campaigns" : templates.find((t) => t.id === value)?.name ?? value)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TEMPLATE}>No template — blank campaigns</SelectItem>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The template&apos;s stage tasks get spawned into every campaign this wizard creates, unassigned.
        </p>
      </div>
    </div>
  );
}
