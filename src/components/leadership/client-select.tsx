"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "NONE";

// "Company-wide" (no client) or one specific client.
export function ClientSelect({
  clients,
  value,
  onChange,
  disabled,
}: {
  clients: { id: string; name: string }[];
  value: string | null;
  onChange: (clientId: string | null) => void;
  disabled?: boolean;
}) {
  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  return (
    <Select value={value ?? NONE} onValueChange={(next) => onChange(!next || next === NONE ? null : next)} disabled={disabled}>
      <SelectTrigger className="w-full max-w-xs">
        <SelectValue>{(v: string) => (v === NONE ? "Company-wide" : (nameById.get(v) ?? "Company-wide"))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Company-wide</SelectItem>
        {clients.map((client) => (
          <SelectItem key={client.id} value={client.id}>
            {client.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
