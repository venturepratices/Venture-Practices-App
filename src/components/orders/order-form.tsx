"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SERVICE_STATUS_VALUES, type Service, type ServiceStatusValue } from "@/lib/validations/client-order";
import type { OrderTemplateField } from "@/lib/validations/order-template";

const SERVICE_STATUS_LABEL: Record<ServiceStatusValue, string> = { ACTIVE: "Active", PAUSED: "Paused", CANCELLED: "Cancelled" };

type ServiceDraft = { name: string; fee: string; status: ServiceStatusValue };

function toDollarsString(cents: number | null) {
  return cents == null ? "" : (cents / 100).toString();
}

function toCents(dollars: string): number {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function OrderForm({
  clientId,
  fromOrderId,
  templateFields,
  initialServices,
  initialAdBudgetCents,
  initialNotes,
  initialCustomFieldValues,
}: {
  clientId: string;
  fromOrderId?: string | null;
  templateFields: OrderTemplateField[];
  initialServices: Service[];
  initialAdBudgetCents: number | null;
  initialNotes: string;
  initialCustomFieldValues: { key: string; value: string | null }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [services, setServices] = useState<ServiceDraft[]>(
    initialServices.length > 0
      ? initialServices.map((s) => ({ name: s.name, fee: toDollarsString(s.feeCents), status: s.status }))
      : [{ name: "", fee: "", status: "ACTIVE" }]
  );
  const [adBudget, setAdBudget] = useState(toDollarsString(initialAdBudgetCents));
  const [notes, setNotes] = useState(initialNotes);
  const [customValues, setCustomValues] = useState<Record<string, string>>(
    Object.fromEntries(initialCustomFieldValues.map((v) => [v.key, v.value ?? ""]))
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateService(index: number, patch: Partial<ServiceDraft>) {
    setServices((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addService() {
    setServices((prev) => [...prev, { name: "", fee: "", status: "ACTIVE" }]);
  }

  function removeService(index: number) {
    setServices((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    setError(null);
    const cleanedServices = services.filter((s) => s.name.trim().length > 0);
    if (cleanedServices.length === 0) {
      setError("Add at least one service.");
      return;
    }

    setIsSubmitting(true);
    const response = await fetch(`/api/clients/${clientId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim() || null,
        fromOrderId: fromOrderId ?? null,
        services: cleanedServices.map((s) => ({ name: s.name.trim(), feeCents: toCents(s.fee), status: s.status })),
        adBudgetCents: adBudget.trim() ? toCents(adBudget) : null,
        notes: notes.trim() || null,
        customFieldValues: templateFields.map((f) => ({ key: f.key, value: customValues[f.key]?.trim() || null })),
      }),
    });
    setIsSubmitting(false);

    if (response.ok) {
      const order = await response.json();
      router.push(`/clients/${clientId}/orders/${order.id}`);
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't save this order.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="order-title">Title (optional)</Label>
        <Input id="order-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Added SEO retainer" />
      </div>

      <div className="space-y-2">
        <Label>Services</Label>
        <div className="space-y-2">
          {services.map((service, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={service.name}
                onChange={(e) => updateService(index, { name: e.target.value })}
                placeholder="Service name"
                className="flex-1"
              />
              <div className="relative w-32">
                <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">$</span>
                <Input
                  value={service.fee}
                  onChange={(e) => updateService(index, { fee: e.target.value })}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="pl-5"
                />
              </div>
              <Select value={service.status} onValueChange={(v) => v && updateService(index, { status: v as ServiceStatusValue })}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue>{(value: ServiceStatusValue) => SERVICE_STATUS_LABEL[value]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_STATUS_VALUES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SERVICE_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon-sm" aria-label="Remove service" onClick={() => removeService(index)}>
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addService}>
          <Plus className="size-4" />
          Add service
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="order-ad-budget">Ad budget (optional, monthly)</Label>
        <div className="relative w-40">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">$</span>
          <Input id="order-ad-budget" value={adBudget} onChange={(e) => setAdBudget(e.target.value)} placeholder="0.00" inputMode="decimal" className="pl-5" />
        </div>
      </div>

      {templateFields.length > 0 ? (
        <div className="space-y-3">
          <Label>Additional details</Label>
          {templateFields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`custom-${field.key}`} className="text-xs font-normal text-muted-foreground">
                {field.label}
                {field.required ? " *" : ""}
              </Label>
              {field.type === "LONGTEXT" ? (
                <Textarea
                  id={`custom-${field.key}`}
                  value={customValues[field.key] ?? ""}
                  onChange={(e) => setCustomValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  rows={3}
                />
              ) : (
                <Input
                  id={`custom-${field.key}`}
                  type={field.type === "DATE" ? "date" : field.type === "NUMBER" ? "number" : "text"}
                  value={customValues[field.key] ?? ""}
                  onChange={(e) => setCustomValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="order-notes">Notes (optional)</Label>
        <Textarea id="order-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
      </div>

      <div className="flex items-center gap-3 border-t pt-4">
        <Button onClick={submit} disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Create document"}
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
