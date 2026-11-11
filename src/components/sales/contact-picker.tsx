"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";

import { searchContactsRequest } from "@/lib/sales/api-client";
import type { ContactRef } from "@/lib/sales/contact-write";
import type { ContactResult } from "@/lib/sales/contacts";
import { cn } from "@/lib/utils";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { MUTED_TEXT } from "@/components/sales/sales-pills";

// The organization and person picker first built for Add deal (mockup
// `newDealModal`), shared by Add deal, new lead, convert and the Details rows
// of deals and leads. Pick an existing contact from the search or type a new
// name. Every request sends a choice through `contactBody`.

/** What the picker holds: a contact found by search (with the line shown under its name), or a new one by name. */
export type ContactChoice =
  | { key: string; kind: "existing"; id: string; name: string; detail: string | null }
  | { key: "new"; kind: "new"; name: string };

const SEARCH_MIN = 2;
const SEARCH_DEBOUNCE_MS = 200;

/** The request's organization or person: an existing one by id, a new one by name, or none. */
export function contactBody(choice: ContactChoice | null): ContactRef {
  if (!choice) return null;
  return choice.kind === "existing" ? { id: choice.id } : { name: choice.name };
}

/** A search result, or a panel's `{ id, name }`, as a picked contact. */
export function existingChoice(kind: "person" | "organization", result: ContactResult): ContactChoice {
  return { key: `${kind}:${result.id}`, kind: "existing", id: result.id, name: result.name, detail: result.organizationName ?? null };
}

/**
 * Search existing people or organizations (from two letters), or add a new one
 * by name: the last option is always "Add new person: {text}". Leaving the box
 * with a typed name and nothing picked keeps what was typed (an exact match
 * becomes that existing one), as the mockup's plain text box would. Opening
 * and closing the list without typing changes nothing, even when the picker
 * starts with a value (`existingChoice(kind, { id, name })`); keep that value
 * the same object between renders, since a new one resets the box's text.
 */
export function ContactPicker({
  kind,
  label,
  placeholder,
  inputRef,
  value,
  onChange,
  disabled,
}: {
  kind: "organization" | "person";
  label: string;
  placeholder: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  value: ContactChoice | null;
  onChange: (value: ContactChoice | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  // The box's text as Base UI last reported it. Null until it reports any:
  // Base UI fills the box from a starting `value` without reporting it, so
  // until then the box still shows `value` (or nothing) and leaving it changes
  // nothing. Not seeded from `value`, so a filled picker sends no search.
  const [text, setText] = useState<string | null>(null);
  const [found, setFound] = useState<ContactResult[]>([]);
  const query = (text ?? "").trim();

  useEffect(() => {
    if (query.length < SEARCH_MIN) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await searchContactsRequest(kind, query);
      // A failed search just offers "Add new"; the person can still save.
      if (!cancelled) setFound(result.ok ? result.data.results : []);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, query]);

  const results = query.length >= SEARCH_MIN ? found : [];
  const newChoice: ContactChoice | null = query ? { key: "new", kind: "new", name: query } : null;
  const items: ContactChoice[] = [...results.map((result) => existingChoice(kind, result)), ...(newChoice ? [newChoice] : [])];
  const noun = kind === "person" ? "person" : "organization";

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={`${id}-input`} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Combobox<ContactChoice>
        items={items}
        filter={null}
        autoHighlight
        value={value}
        // On the root too: Base UI's box opens the list on a press beside the input unless the whole combobox is off.
        disabled={disabled}
        itemToStringLabel={(choice) => choice.name}
        isItemEqualToValue={(a, b) => a.key === b.key}
        onValueChange={(choice) => onChange(choice ?? null)}
        onInputValueChange={(next) => setText(next)}
        onOpenChange={(isOpen, details) => {
          if (isOpen || details.reason === "item-press" || text === null) return;
          if (!query) {
            if (value) onChange(null);
            return;
          }
          if (value && value.name === query) return;
          const exact = results.find((result) => result.name.toLowerCase() === query.toLowerCase());
          onChange(exact ? existingChoice(kind, exact) : { key: "new", kind: "new", name: query });
        }}
      >
        {/* Disabled, it fades like the Owner and Pipeline selects beside it (the shared box has no disabled look). */}
        <ComboboxInputGroup className="pointer-coarse:h-10 has-disabled:cursor-not-allowed has-disabled:opacity-50">
          <ComboboxInput
            ref={inputRef}
            id={`${id}-input`}
            placeholder={placeholder}
            autoComplete="off"
            disabled={disabled}
            className="pr-8"
          />
          <div className="absolute right-1 flex items-center">
            <ComboboxTrigger aria-label={`Show ${noun} matches`} disabled={disabled} className="pointer-coarse:size-8">
              <ChevronDown className="size-3.5" />
            </ComboboxTrigger>
          </div>
        </ComboboxInputGroup>
        {/* Exactly the box's width (the shared popup's own), so it never runs past the dialog and never follows the options; long names wrap. */}
        <ComboboxContent>
          <ComboboxEmpty>Type a name to search.</ComboboxEmpty>
          <ComboboxList>
            {(choice: ContactChoice) => (
              <ComboboxItem key={choice.key} value={choice} className="pointer-coarse:min-h-10">
                {choice.kind === "new" ? (
                  <span className="flex min-w-0 items-start gap-1.5">
                    <Plus aria-hidden="true" className="mt-[3px] size-3.5 shrink-0" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      Add new {noun}: {choice.name}
                    </span>
                  </span>
                ) : (
                  <span className="flex min-w-0 flex-col">
                    <span className="[overflow-wrap:anywhere]">{choice.name}</span>
                    {choice.detail ? (
                      <span className={cn("text-xs [overflow-wrap:anywhere]", MUTED_TEXT)}>{choice.detail}</span>
                    ) : null}
                  </span>
                )}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
