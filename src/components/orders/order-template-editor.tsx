"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, GripVertical, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
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

export type OrderTemplateSummary = {
  id: string;
  name: string;
  customFields: OrderTemplateField[];
};

export function OrderTemplateEditor({ template }: { template: OrderTemplateSummary }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState<OrderTemplateField[]>(template.customFields);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = JSON.stringify(fields) !== JSON.stringify(template.customFields);

  function update(index: number, patch: Partial<OrderTemplateField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function addField() {
    setFields((prev) => [...prev, { key: newFieldKey(prev), label: "", type: "TEXT", required: false }]);
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    setError(null);
    setIsSaving(true);
    const response = await fetch(`/api/order-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customFields: fields }),
    });
    setIsSaving(false);
    if (response.ok) {
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't save the template.");
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete template "${template.name}"? Orders already created from it are unaffected.`)) return;
    setIsDeleting(true);
    const response = await fetch(`/api/order-templates/${template.id}`, { method: "DELETE" });
    setIsDeleting(false);
    if (response.ok) router.refresh();
  }

  return (
    <div className="rounded-lg border">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <div>
          <p className="font-medium">{template.name}</p>
          <p className="text-xs text-muted-foreground">
            {fields.length} custom field{fields.length === 1 ? "" : "s"}
          </p>
        </div>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded ? (
        <div className="border-t px-4 py-4">
          <div className="flex items-center justify-between pb-4">
            <p className="text-sm text-muted-foreground">
              Every Order and Change Order always carries services, an ad budget, and notes — fields added here show
              up in addition, only for orders started from this template.
            </p>
            <Button variant="ghost" size="sm" className="shrink-0 text-destructive" onClick={handleDelete} disabled={isDeleting}>
              <Trash2 className="size-3.5" />
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>

          <Separator />

          <div className="mt-4 space-y-4">
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
                No custom fields yet — orders started from this template will just have services, ad budget, and
                notes.
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
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
