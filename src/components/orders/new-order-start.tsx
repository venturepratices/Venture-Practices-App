"use client";

import { useState } from "react";
import { ChevronLeft, FileText, Sparkles } from "lucide-react";

import { OrderForm } from "@/components/orders/order-form";
import type { OrderTemplateField } from "@/lib/validations/order-template";

type TemplateOption = { id: string; name: string; customFields: OrderTemplateField[] };

export function NewOrderStart({ clientId, templates }: { clientId: string; templates: TemplateOption[] }) {
  // Nothing to choose from, so skip straight to a blank form rather than
  // showing a chooser with a single meaningless option.
  const [selected, setSelected] = useState<"unset" | "blank" | string>(templates.length === 0 ? "blank" : "unset");

  if (selected === "unset") {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">How do you want to start this order?</p>
        <div className="mt-3 space-y-2">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => setSelected(template.id)}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted"
            >
              <Sparkles className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{template.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {template.customFields.length} custom field{template.customFields.length === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))}
          <button
            onClick={() => setSelected("blank")}
            className="flex w-full items-center gap-3 rounded-lg border border-dashed p-3 text-left transition-colors hover:bg-muted"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">Start blank</span>
              <span className="block text-xs text-muted-foreground">No template — just services, ad budget, and notes.</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  const template = selected === "blank" ? null : templates.find((t) => t.id === selected) ?? null;

  return (
    <div>
      {templates.length > 0 ? (
        <button
          onClick={() => setSelected("unset")}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Change starting point
        </button>
      ) : null}
      <OrderForm
        clientId={clientId}
        templateId={template?.id ?? null}
        templateFields={template?.customFields ?? []}
        initialServices={[]}
        initialAdBudgetCents={null}
        initialNotes=""
        initialCustomFieldValues={[]}
      />
    </div>
  );
}
