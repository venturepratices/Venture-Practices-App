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
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { matchesFilterQuery, type FilterItem } from "@/lib/calls/filter-match";

/**
 * A filter you can type in. Click it and type a few letters (or digits) and
 * the list narrows, so nobody has to scroll to find one client or number.
 * Empty means "all". Same look as the Activity page's client filter.
 */
export function SearchableFilter({
  items,
  value,
  onChange,
  placeholder,
  emptyText,
  ariaLabel,
  allowClear = true,
}: {
  items: FilterItem[];
  /** The chosen item's value, or null for "all". */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Shown while nothing is chosen, for example "All clients". */
  placeholder: string;
  emptyText: string;
  ariaLabel: string;
  /** Show the little X that clears the choice. Off for filters that always have a value (Date range, Status). */
  allowClear?: boolean;
}) {
  const selected = items.find((i) => i.value === value) ?? null;

  return (
    <Combobox
      items={items}
      value={selected}
      onValueChange={(item: FilterItem | null) => onChange(item ? item.value : null)}
      filter={(item: FilterItem, query: string) => matchesFilterQuery(item, query)}
    >
      <ComboboxInputGroup className="w-full">
        {/* Selecting the text on focus means typing replaces the current choice
            instead of being added after it. */}
        <ComboboxInput
          placeholder={placeholder}
          aria-label={ariaLabel}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="absolute right-1 flex items-center">
          {allowClear ? (
            <ComboboxClear aria-label={`Clear ${ariaLabel.toLowerCase()} filter`}>
              <X className="size-3.5" />
            </ComboboxClear>
          ) : null}
          <ComboboxTrigger aria-label={`Open ${ariaLabel.toLowerCase()} list`}>
            <ChevronDown className="size-3.5" />
          </ComboboxTrigger>
        </div>
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(item: FilterItem) => (
            <ComboboxItem key={item.value} value={item}>
              <TruncateTooltip text={item.label} />
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
