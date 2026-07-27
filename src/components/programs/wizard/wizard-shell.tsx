"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

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
import { TemplateStep } from "@/components/programs/wizard/template-step";
import { ScheduleStep } from "@/components/programs/wizard/schedule-step";
import { DefaultsStep } from "@/components/programs/wizard/defaults-step";
import { ReviewStep } from "@/components/programs/wizard/review-step";

export type WizardDraft = {
  templateId: string | null;
  startMonth: string; // "YYYY-MM"
  lengthMonths: string;
  mailDayOfMonth: string;
  quantity: string;
  budget: string;
  geography: string;
  offer: string;
  cta: string;
};

const INITIAL_DRAFT: WizardDraft = {
  templateId: null,
  startMonth: "",
  lengthMonths: "6",
  mailDayOfMonth: "15",
  quantity: "",
  budget: "",
  geography: "",
  offer: "",
  cta: "",
};

const STEPS = ["Template", "Schedule", "Defaults", "Review"] as const;

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function CampaignWizardDialog({
  clientId,
  trigger,
  templates,
}: {
  clientId: string;
  trigger: React.ReactElement;
  templates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<WizardDraft>(INITIAL_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function setField<K extends keyof WizardDraft>(key: K, value: WizardDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function reset() {
    setDraft(INITIAL_DRAFT);
    setStep(0);
    setError(null);
  }

  const canProceed = true;

  async function submit() {
    setError(null);
    setIsSaving(true);
    const response = await fetch("/api/campaigns/wizard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        templateId: draft.templateId,
        // If left blank, default to the current month rather than blocking
        // the wizard on a date the user may not have decided yet.
        startMonth: new Date(`${draft.startMonth || currentMonthValue()}-01T00:00:00.000Z`).toISOString(),
        lengthMonths: Number(draft.lengthMonths) || 1,
        mailDayOfMonth: Number(draft.mailDayOfMonth) || 15,
        quantity: draft.quantity ? Number(draft.quantity) : null,
        budgetCents: draft.budget ? Math.round(Number(draft.budget) * 100) : null,
        geography: draft.geography.trim() || null,
        offer: draft.offer.trim() || null,
        cta: draft.cta.trim() || null,
      }),
    });
    setIsSaving(false);

    if (response.ok) {
      setOpen(false);
      reset();
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't run the wizard.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Campaign Generator — {STEPS[step]}</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length}: creates several monthly campaigns for this client at once, and (if a
            template is chosen) spawns every stage task, unassigned — assign people to tasks afterward from the
            campaign page.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {step === 0 ? <TemplateStep draft={draft} setField={setField} templates={templates} /> : null}
          {step === 1 ? <ScheduleStep draft={draft} setField={setField} /> : null}
          {step === 2 ? <DefaultsStep draft={draft} setField={setField} /> : null}
          {step === 3 ? (
            <ReviewStep
              draft={draft}
              templateName={draft.templateId ? templates.find((t) => t.id === draft.templateId)?.name ?? "—" : "None — blank campaigns"}
            />
          ) : null}
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || isSaving}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={!canProceed}>
              Next
            </Button>
          ) : (
            <Button type="button" onClick={submit} disabled={isSaving}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              {isSaving ? "Creating..." : "Create campaigns"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
