"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type IntakeValues = {
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  about: string | null;
  targetAudience: string | null;
  offerDetails: string | null;
  brandGuidelinesUrl: string | null;
  additionalNotes: string | null;
};

function Field({ label, id, value, onChange, textarea }: { label: string; id: string; value: string; onChange: (v: string) => void; textarea?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {textarea ? (
        <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      ) : (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export function ClientIntakeForm({ initial }: { initial: Partial<IntakeValues> }) {
  const router = useRouter();
  const [values, setValues] = useState<IntakeValues>({
    contactName: initial.contactName ?? "",
    contactEmail: initial.contactEmail ?? "",
    contactPhone: initial.contactPhone ?? "",
    website: initial.website ?? "",
    about: initial.about ?? "",
    targetAudience: initial.targetAudience ?? "",
    offerDetails: initial.offerDetails ?? "",
    brandGuidelinesUrl: initial.brandGuidelinesUrl ?? "",
    additionalNotes: initial.additionalNotes ?? "",
  } as IntakeValues);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function setField(key: keyof IntakeValues, value: string) {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setIsSaving(true);
    const response = await fetch("/api/portal/intake", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setIsSaving(false);
    if (response.ok) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Contact name" id="contactName" value={values.contactName ?? ""} onChange={(v) => setField("contactName", v)} />
        <Field label="Contact email" id="contactEmail" value={values.contactEmail ?? ""} onChange={(v) => setField("contactEmail", v)} />
        <Field label="Contact phone" id="contactPhone" value={values.contactPhone ?? ""} onChange={(v) => setField("contactPhone", v)} />
        <Field label="Website" id="website" value={values.website ?? ""} onChange={(v) => setField("website", v)} />
      </div>
      <Field label="About your business" id="about" value={values.about ?? ""} onChange={(v) => setField("about", v)} textarea />
      <Field label="Who's your target audience?" id="targetAudience" value={values.targetAudience ?? ""} onChange={(v) => setField("targetAudience", v)} textarea />
      <Field label="Typical offer for direct mail" id="offerDetails" value={values.offerDetails ?? ""} onChange={(v) => setField("offerDetails", v)} textarea />
      <Field
        label="Brand guidelines link (if you have one)"
        id="brandGuidelinesUrl"
        value={values.brandGuidelinesUrl ?? ""}
        onChange={(v) => setField("brandGuidelinesUrl", v)}
      />
      <Field label="Anything else we should know?" id="additionalNotes" value={values.additionalNotes ?? ""} onChange={(v) => setField("additionalNotes", v)} textarea />

      <div className="flex items-center gap-3 pt-2">
        <Button type="button" onClick={save} disabled={isSaving}>
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
          {isSaving ? "Saving..." : "Save"}
        </Button>
        {saved ? (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" /> Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
