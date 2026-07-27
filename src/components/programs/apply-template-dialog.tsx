"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const UNASSIGNED = "__none__";

function TeamMemberField({
  label,
  value,
  onChange,
  teamMembers,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  teamMembers: { id: string; name: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value ?? UNASSIGNED} onValueChange={(v) => v && onChange(v === UNASSIGNED ? null : v)}>
        <SelectTrigger className="w-full">
          <SelectValue>
            {(v: string) => (v === UNASSIGNED ? "Unassigned" : teamMembers.find((m) => m.id === v)?.name ?? v)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {teamMembers.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ApplyTemplateDialog({
  campaignId,
  templates,
  teamMembers,
  defaultAccountManagerId,
  defaultCreativeId,
  defaultProductionId,
}: {
  campaignId: string;
  templates: { id: string; name: string }[];
  teamMembers: { id: string; name: string }[];
  defaultAccountManagerId: string | null;
  defaultCreativeId: string | null;
  defaultProductionId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const [accountManagerId, setAccountManagerId] = useState(defaultAccountManagerId);
  const [creativeId, setCreativeId] = useState(defaultCreativeId);
  const [productionId, setProductionId] = useState(defaultProductionId);
  const [error, setError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  async function handleApply() {
    if (!templateId) return;
    setError(null);
    setIsApplying(true);
    const response = await fetch(`/api/campaigns/${campaignId}/apply-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, accountManagerId, creativeId, productionId }),
    });
    setIsApplying(false);

    if (response.ok) {
      setOpen(false);
      router.refresh();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Couldn't apply that template.");
    }
  }

  if (templates.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" size="sm">
            <Sparkles className="size-4" />
            Apply template
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply a task template</DialogTitle>
          <DialogDescription>
            Spawns every stage task from the chosen template into this campaign, with assignees resolved from the roles
            below. "Client" role tasks always stay unassigned agency-side.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select value={templateId ?? ""} onValueChange={(v) => v && setTemplateId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => templates.find((t) => t.id === v)?.name ?? "Choose a template"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TeamMemberField label="Account Manager" value={accountManagerId} onChange={setAccountManagerId} teamMembers={teamMembers} />
          <TeamMemberField label="Creative" value={creativeId} onChange={setCreativeId} teamMembers={teamMembers} />
          <TeamMemberField label="Production" value={productionId} onChange={setProductionId} teamMembers={teamMembers} />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleApply} disabled={isApplying || !templateId}>
            {isApplying ? <Loader2 className="size-4 animate-spin" /> : null}
            {isApplying ? "Applying..." : "Apply template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
