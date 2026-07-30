"use client";

import { ChevronDown, X } from "lucide-react";

import {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";

export type ProjectOption = { id: string; name: string; clientName: string | null };

type ComboItem = { value: string; label: string };

// Searchable single-select for picking exactly which live Project (workflow
// instance) a task is under — plain category pills ("Project") stopped being
// enough once there are many projects to choose from; this is a real search,
// not just a longer dropdown.
export function ProjectPicker({
  projects,
  value,
  onChange,
  disabled,
}: {
  projects: ProjectOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const items: ComboItem[] = projects.map((p) => ({
    value: p.id,
    label: p.clientName ? `${p.name} — ${p.clientName}` : p.name,
  }));
  const selected = items.find((i) => i.value === value) ?? null;

  return (
    <Combobox
      items={items}
      value={selected}
      onValueChange={(item) => onChange(item ? item.value : null)}
      disabled={disabled}
    >
      <ComboboxInputGroup>
        <ComboboxInput placeholder="Search projects..." />
        <div className="absolute right-1 flex items-center">
          <ComboboxClear aria-label="Clear selection">
            <X className="size-3.5" />
          </ComboboxClear>
          <ComboboxTrigger aria-label="Open projects list">
            <ChevronDown className="size-3.5" />
          </ComboboxTrigger>
        </div>
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>No projects found.</ComboboxEmpty>
        <ComboboxList>
          {(item: ComboItem) => (
            <ComboboxItem key={item.value} value={item}>
              <span className="truncate">{item.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
