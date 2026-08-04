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

type ComboItem = { value: string; label: string };

// Searchable single-select for the Activity page's client filter — plain
// category pills stopped being enough once there are many clients to choose
// from; mirrors src/components/tasks/project-picker.tsx's exact shape.
export function ClientFilterCombobox({
  clients,
  value,
  onChange,
}: {
  clients: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const items: ComboItem[] = clients.map((c) => ({ value: c.id, label: c.name }));
  const selected = items.find((i) => i.value === value) ?? null;

  return (
    <Combobox items={items} value={selected} onValueChange={(item) => onChange(item ? item.value : null)}>
      <ComboboxInputGroup className="w-full sm:w-56">
        <ComboboxInput placeholder="All clients" />
        <div className="absolute right-1 flex items-center">
          <ComboboxClear aria-label="Clear client filter">
            <X className="size-3.5" />
          </ComboboxClear>
          <ComboboxTrigger aria-label="Open clients list">
            <ChevronDown className="size-3.5" />
          </ComboboxTrigger>
        </div>
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>No clients found.</ComboboxEmpty>
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
