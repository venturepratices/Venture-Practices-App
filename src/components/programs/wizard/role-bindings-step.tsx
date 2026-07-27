"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WizardDraft } from "@/components/programs/wizard/wizard-shell";

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

export function RoleBindingsStep({
  draft,
  setField,
  teamMembers,
}: {
  draft: WizardDraft;
  setField: <K extends keyof WizardDraft>(key: K, value: WizardDraft[K]) => void;
  teamMembers: { id: string; name: string }[];
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Who the template's role-tagged tasks resolve to for this program. "Client" role tasks always stay
        unassigned agency-side.
      </p>
      <TeamMemberField
        label="Account Manager"
        value={draft.accountManagerId}
        onChange={(v) => setField("accountManagerId", v)}
        teamMembers={teamMembers}
      />
      <TeamMemberField
        label="Creative"
        value={draft.creativeId}
        onChange={(v) => setField("creativeId", v)}
        teamMembers={teamMembers}
      />
      <TeamMemberField
        label="Production"
        value={draft.productionId}
        onChange={(v) => setField("productionId", v)}
        teamMembers={teamMembers}
      />
    </div>
  );
}
