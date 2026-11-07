"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { setLeadFieldRequest, updateLeadRequest, type ApiResult } from "@/lib/sales/api-client";
import { DEAL_SOURCES } from "@/lib/sales/constants";
import type { ContactRef } from "@/lib/sales/contact-write";
import type { LeadPanelData } from "@/lib/sales/lead-panel";
import { changePanelUrl, panelHref } from "@/lib/sales/panel-url";
import { cn, formatDate } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { contactBody, type ContactChoice, ContactPicker, existingChoice } from "@/components/sales/contact-picker";
import { CELL_CONTROL, CustomFieldRow, LABEL_CELL } from "@/components/sales/deal-details";
import { SECTION_HEADING } from "@/components/sales/next-steps";

// The lead panel's "Details" (Mockup v2 `#s=lead-open`, `#s=lead-edit-org`):
// the deal panel's label and value grid with the lead's Source, its
// Organization and Person (each with "Change" for the owner or an admin and
// "Open" for its contact panel), the lead custom fields the panel shows
// (Practice ZIP), and when it came in. Everything saves on its own, as on a
// deal; a refusal shows where the change was made.

type Source = (typeof DEAL_SOURCES)[number];

const SOURCE_ITEMS = Object.fromEntries(DEAL_SOURCES.map((source) => [source, source])) as Record<Source, string>;

/** "Change" and "Open" beside a name: the Sales link ink (AA on the panel in both themes), 40px to touch. */
const CELL_LINK =
  "rounded-sm text-xs font-semibold text-cyan-700 underline underline-offset-2 outline-none hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50 dark:text-sky-300 pointer-coarse:-my-2.5 pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center";

export function LeadDetails({ data, onSaved }: { data: LeadPanelData; onSaved: () => void }) {
  const { lead, fields, canEdit } = data;
  const id = useId();

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-2">
      <h3 id={`${id}-heading`} className={SECTION_HEADING}>
        Details
      </h3>
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] overflow-hidden rounded-[9px] border text-[13px] sm:grid-cols-[150px_minmax(0,1fr)] [&>:nth-last-child(-n+2)]:border-b-0">
        <dt className={LABEL_CELL} id={`${id}-source`}>
          Source
        </dt>
        <dd className="m-0 min-w-0 border-b">
          {canEdit ? (
            <LeadSourceSelect leadId={lead.id} source={lead.source} labelId={`${id}-source`} onSaved={onSaved} />
          ) : (
            <span className="block px-2.5 py-[7px] break-words">{lead.source}</span>
          )}
        </dd>

        <dt className={LABEL_CELL}>Organization</dt>
        <ContactCell
          kind="organization"
          contact={lead.organization}
          canEdit={canEdit}
          save={(ref) => updateLeadRequest(lead.id, { organization: ref })}
          onSaved={onSaved}
        />

        <dt className={LABEL_CELL}>Person</dt>
        <ContactCell
          kind="person"
          contact={lead.person}
          canEdit={canEdit}
          save={(ref) => updateLeadRequest(lead.id, { person: ref })}
          onSaved={onSaved}
        />

        {fields.map((field) => (
          <CustomFieldRow
            key={field.key}
            field={field}
            canEdit={canEdit}
            save={(fieldKey, value) => setLeadFieldRequest(lead.id, fieldKey, value)}
            onSaved={onSaved}
          />
        ))}

        <dt className={LABEL_CELL}>Created</dt>
        <dd className="m-0 min-w-0 border-b px-2.5 py-[7px] tabular-nums">
          {formatDate(lead.createdAt, { month: "short", day: "numeric", year: "numeric" })}
        </dd>
      </dl>
    </section>
  );
}

/** A lead always has a source (Decision 8), so the list has no "Not set". */
function LeadSourceSelect({
  leadId,
  source,
  labelId,
  onSaved,
}: {
  leadId: string;
  source: string;
  labelId: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(source);
  // A reload brought a different stored source: show it (without remounting, so focus stays on the list).
  const [stored, setStored] = useState(source);
  if (source !== stored) {
    setStored(source);
    setValue(source);
  }

  async function change(next: unknown) {
    const picked = DEAL_SOURCES.find((option) => option === next);
    if (!picked || picked === value) return;
    const previous = value;
    setValue(picked);
    const result = await updateLeadRequest(leadId, { source: picked });
    if (!result.ok) {
      setValue(previous);
      toast.error(result.error);
      return;
    }
    onSaved();
  }

  return (
    <Select items={SOURCE_ITEMS} value={value} onValueChange={(next) => void change(next)}>
      <SelectTrigger aria-labelledby={labelId} className={cn(CELL_CONTROL, "justify-between")}>
        <SelectValue className="truncate" />
      </SelectTrigger>
      <SelectContent>
        {DEAL_SOURCES.map((option) => (
          <SelectItem key={option} value={option} className="pointer-coarse:min-h-10">
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The same contact, so picking it again saves nothing (Mockup v2 build note). */
function sameContact(choice: ContactChoice | null, contact: { id: string } | null): boolean {
  if (!choice || !contact) return choice === null && contact === null;
  return choice.kind === "existing" && choice.id === contact.id;
}

/**
 * An Organization or Person value cell (Mockup v2 `pickCell`): the name, then
 * "Change" (or "Add") for whoever may edit, and "Open" for the contact's own
 * panel. Change turns the cell into the Add deal picker, started from the
 * contact there now: picking one, or typing a new name and leaving the box,
 * saves it; emptying the box and leaving clears it; Esc (or leaving without
 * typing) puts the name back. Never a button inside a button.
 */
export function ContactCell({
  kind,
  contact,
  canEdit,
  save,
  onSaved,
}: {
  kind: "organization" | "person";
  contact: { id: string; name: string } | null;
  canEdit: boolean;
  save: (ref: ContactRef) => Promise<ApiResult<unknown>>;
  onSaved: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState(false);
  // The picker's value: the contact here now when Change opened it (one object, so Base UI keeps the box's text).
  const [choice, setChoice] = useState<ContactChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  // While the picker is open for a change: a pick, a typed name or Esc ends it, once.
  const live = useRef(false);
  // Something was typed since Change: leaving the box then is the picker's to settle (a new name or a clear).
  const typed = useRef(false);
  // Focus goes back to Change once the picker closes, unless the person moved it somewhere else.
  const refocus = useRef(false);
  const noun = kind === "organization" ? "organization" : "person";

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    } else if (refocus.current) {
      refocus.current = false;
      // Only when focus was lost with the picker (Esc, a pick); a Tab to the next field keeps its place.
      const active = document.activeElement;
      if (!active || active === document.body) changeRef.current?.focus();
    }
  }, [editing]);

  function start() {
    setChoice(contact ? existingChoice(kind, contact) : null);
    setError(null);
    live.current = true;
    typed.current = false;
    setEditing(true);
  }

  function finish(returnFocus: boolean) {
    live.current = false;
    setEditing(false);
    setError(null);
    refocus.current = returnFocus;
  }

  async function pick(next: ContactChoice | null) {
    if (!live.current) return;
    setChoice(next);
    if (sameContact(next, contact)) {
      finish(true);
      return;
    }
    live.current = false;
    setSaving(true);
    const result = await save(contactBody(next));
    setSaving(false);
    if (!result.ok) {
      // Stay open on the refusal, so the person can pick again or press Esc.
      setError(result.error);
      live.current = true;
      typed.current = false;
      return;
    }
    finish(true);
    onSaved();
  }

  const name = contact ? <span className="min-w-0 break-words">{contact.name}</span> : <span className="text-muted-foreground">Not set</span>;

  if (editing) {
    return (
      <dd
        className="m-0 min-w-0 border-b px-2 py-1.5"
        aria-busy={saving || undefined}
        onInputCapture={() => {
          typed.current = true;
        }}
        onKeyDownCapture={(event) => {
          // Esc cancels the change and keeps the panel open (a second Esc closes it).
          if (event.key !== "Escape" || event.nativeEvent.isComposing || saving) return;
          event.preventDefault();
          event.stopPropagation();
          finish(true);
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          // Nothing typed: leaving changes nothing. A typed name is saved by the picker as it closes.
          if (!typed.current && live.current && !saving) finish(false);
        }}
      >
        {/* The row's own label names the box; the picker's label stays for screen readers only. */}
        <div className="[&_label]:sr-only">
          <ContactPicker
            kind={kind}
            label={contact ? `Change ${noun}` : `Add ${noun}`}
            placeholder={kind === "organization" ? "Search or add a practice" : "Search or add a person"}
            inputRef={inputRef}
            value={choice}
            onChange={(next) => void pick(next)}
            disabled={saving}
          />
        </div>
        {error ? (
          <p role="alert" className="m-0 mt-1 text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p className="m-0 mt-1 text-xs text-muted-foreground">Pick one, or type a new name. Esc to cancel.</p>
        )}
      </dd>
    );
  }

  const openHref = contact ? panelHref(pathname, searchParams.toString(), { kind, id: contact.id }) : null;

  return (
    <dd className="m-0 flex min-w-0 flex-wrap items-center justify-between gap-x-2.5 gap-y-1 border-b px-2.5 py-[7px]">
      {name}
      {canEdit || openHref ? (
        <span className="flex shrink-0 items-center gap-2.5">
          {canEdit ? (
            <button
              ref={changeRef}
              type="button"
              aria-label={contact ? `Change ${noun}` : `Add ${noun}`}
              onClick={start}
              className={CELL_LINK}
            >
              {contact ? "Change" : "Add"}
            </button>
          ) : null}
          {contact && openHref ? (
            <Link
              href={openHref}
              scroll={false}
              aria-label={`Open ${contact.name}`}
              // The contact's panel takes this one's place, with no page load (Ctrl or Cmd still opens a tab).
              onNavigate={(event) => {
                event.preventDefault();
                changePanelUrl(openHref, "push", router);
              }}
              className={CELL_LINK}
            >
              Open
            </Link>
          ) : null}
        </span>
      ) : null}
    </dd>
  );
}
