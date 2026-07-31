"use client";

import { useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ORDER_FIELD_TYPES, type OrderFieldTypeValue, type OrderTemplateField } from "@/lib/validations/order-template";

const TYPE_LABELS: Record<OrderFieldTypeValue, string> = {
  TEXT: "Plain text",
  NUMBER: "Number",
  DATE: "Date",
  LONGTEXT: "Long text",
};

function newFieldKey(existing: OrderTemplateField[]) {
  let n = existing.length + 1;
  while (existing.some((f) => f.key === `field_${n}`)) n += 1;
  return `field_${n}`;
}

export function OrderTemplateEditor({ initialFields }: { initialFields: OrderTemplateField[] }) {
  const [fields, setFields] = useState<OrderTemplateField[]>(initialFields);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(index: number, patch: Partial<OrderTemplateField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
    setIsDirty(true);
    setSaved(false);
  }

  function addField() {
    const field: OrderTemplateField = { key: newFieldKey(fields), label: "", type: "TEXT", required: false };
    setFields((prev) => [...prev, field]);
    setIsDirty(true);
    setSaved(false);
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
    setIsDirty(true);
    setSaved(false);
  }

  async function save() {
    setError(null);
    setIsSaving(true);
    const response = await fetch("/api/order-template", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customFields: fields }),
    });
    setIsSaving(false);
    if (response.ok) {
      setIsDirty(false);
      setSaved(true);
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't save the template.");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Custom fields</p>
        <p className="text-sm text-muted-foreground">
          Every Order and Change Order always carries services, an ad budget, and notes. Add extra fields here to
          capture anything else your team needs — they'll show up on every new document going forward.
        </p>
      </div>

      {fields.length > 0 ? (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={index} className="flex items-center gap-2 rounded-lg border p-2.5">
              <GripVertical className="size-4 shrink-0 text-muted-foreground/50" />
              <Input
                value={field.label}
                onChange={(e) => update(index, { label: e.target.value })}
                placeholder="Field label"
                className="h-8 flex-1 text-sm"
              />
              <Select value={field.type} onValueChange={(value) => value && update(index, { type: value as OrderFieldTypeValue })}>
                <SelectTrigger className="h-8 w-[140px] text-sm">
                  <SelectValue>{(value: OrderFieldTypeValue) => TYPE_LABELS[value]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ORDER_FIELD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox checked={field.required} onCheckedChange={(checked) => update(index, { required: !!checked })} />
                Required
              </Label>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${field.label || "field"}`} onClick={() => removeField(index)}>
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          No custom fields yet — Orders will just have services, ad budget, and notes.
        </p>
      )}

      <Button variant="outline" size="sm" className="gap-1.5" onClick={addField}>
        <Plus className="size-4" />
        Add field
      </Button>

      <div className="flex items-center gap-3 border-t pt-4">
        <Button onClick={save} disabled={!isDirty || isSaving}>
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
        {saved ? <p className="text-sm text-muted-foreground">Saved.</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
