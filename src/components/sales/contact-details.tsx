"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { updateContactRequest, type ApiResult } from "@/lib/sales/api-client";
import type { OrganizationPanelData, PersonPanelData } from "@/lib/sales/contact-panel";
import { mailtoHref, safeWebHref, telHref } from "@/lib/sales/contact-links";
import type { UpdateOrganizationInput, UpdatePersonInput } from "@/lib/sales/contacts-edit";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  contactBody,
  type ContactChoice,
  ContactPicker,
  existingChoice,
} from "@/components/sales/contact-picker";
import { CELL_CONTROL, LABEL_CELL } from "@/components/sales/deal-details";
import { SECTION_HEADING } from "@/components/sales/next-steps";

// The contact panel's "Details" (Mockup v2 `personPanel`, `orgPanel`): the
// same label-and-value grid the deal panel uses, with one row per field. The
// owner or an admin edits in place: click (or Enter) opens the inline input;
// blur or Enter saves through updateContactRequest with only that field; Esc
// reverts. A refusal shows under the field; the typed text stays so the
// person can fix and try again. Email, phone and website render as real links
// when stored safely, and never as a link when they do not pass the check
// (safeWebHref, mailtoHref, telHref; spec 18.4, Decision 18). The Organization
// row on a person uses the Add deal picker (ContactPicker) and saves the
// chosen contact.

type ContactUpdate = UpdatePersonInput | UpdateOrganizationInput;

/** A person's editable detail fields (text or picker). */
type PersonFieldKey = "name" | "email" | "phone" | "role" | "organization";
/** An organization's editable detail fields. */
type OrganizationFieldKey = "name" | "phone" | "website" | "address" | "zip";

const PERSON_LABELS: Record<PersonFieldKey, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  role: "Role in practice",
  organization: "Organization",
};

const ORGANIZATION_LABELS: Record<OrganizationFieldKey, string> = {
  name: "Name",
  phone: "Phone",
  website: "Website",
  address: "Address",
  zip: "ZIP",
};

/** The maximum length for a short text field; matches the server's limits. */
const SHORT_MAX = 200;

/** A text or link cell's save contract. */
type SaveField = (patch: ContactUpdate) => Promise<ApiResult<{ changed: boolean; contact: { id: string; name: string } }>>;

export function PersonDetails({ data, onChanged }: { data: PersonPanelData; onChanged: () => void }) {
  const id = useId();
  const { person, canEdit } = data;
  const save: SaveField = (patch) => updateContactRequest("person", person.id, patch);

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-2">
      <h3 id={`${id}-heading`} className={SECTION_HEADING}>
        Details
      </h3>
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] overflow-hidden rounded-[9px] border text-[13px] sm:grid-cols-[150px_minmax(0,1fr)] [&>:nth-last-child(-n+2)]:border-b-0 max-[400px]:grid-cols-[minmax(0,1fr)]">
        <TextRow label={PERSON_LABELS.name} value={person.name} field="name" canEdit={canEdit} save={save} onChanged={onChanged} />
        <LinkRow
          label={PERSON_LABELS.email}
          value={person.email}
          type="email"
          href={mailtoHref(person.email)}
          field="email"
          canEdit={canEdit}
          save={save}
          onChanged={onChanged}
        />
        <LinkRow
          label={PERSON_LABELS.phone}
          value={person.phone}
          type="tel"
          href={telHref(person.phone)}
          field="phone"
          canEdit={canEdit}
          save={save}
          onChanged={onChanged}
        />
        <TextRow label={PERSON_LABELS.role} value={person.role} field="role" canEdit={canEdit} save={save} onChanged={onChanged} />
        <OrganizationRow data={data} save={save} onChanged={onChanged} />
      </dl>
    </section>
  );
}

export function OrganizationDetails({
  data,
  onChanged,
}: {
  data: OrganizationPanelData;
  onChanged: () => void;
}) {
  const id = useId();
  const { organization, canEdit } = data;
  const save: SaveField = (patch) => updateContactRequest("organization", organization.id, patch);

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-2">
      <h3 id={`${id}-heading`} className={SECTION_HEADING}>
        Details
      </h3>
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] overflow-hidden rounded-[9px] border text-[13px] sm:grid-cols-[150px_minmax(0,1fr)] [&>:nth-last-child(-n+2)]:border-b-0 max-[400px]:grid-cols-[minmax(0,1fr)]">
        <TextRow label={ORGANIZATION_LABELS.name} value={organization.name} field="name" canEdit={canEdit} save={save} onChanged={onChanged} />
        <LinkRow
          label={ORGANIZATION_LABELS.phone}
          value={organization.phone}
          type="tel"
          href={telHref(organization.phone)}
          field="phone"
          canEdit={canEdit}
          save={save}
          onChanged={onChanged}
        />
        <LinkRow
          label={ORGANIZATION_LABELS.website}
          value={organization.website}
          type="url"
          href={safeWebHref(organization.website)}
          field="website"
          canEdit={canEdit}
          save={save}
          onChanged={onChanged}
          isWebsite
        />
        <TextRow label={ORGANIZATION_LABELS.address} value={organization.address} field="address" canEdit={canEdit} save={save} onChanged={onChanged} />
        <TextRow label={ORGANIZATION_LABELS.zip} value={organization.zip} field="zip" canEdit={canEdit} save={save} onChanged={onChanged} mode="numeric" />
      </dl>
    </section>
  );
}

// --- Rows ---

type InlineRowProps<K extends string> = {
  label: string;
  value: string | null;
  field: K;
  canEdit: boolean;
  save: SaveField;
  onChanged: () => void;
};

function LinkRow({
  label,
  value,
  type,
  href,
  field,
  canEdit,
  save,
  onChanged,
  isWebsite = false,
}: InlineRowProps<string> & { type: "email" | "tel" | "url"; href: string | null; isWebsite?: boolean }) {
  const [editing, setEditing] = useState(false);
  const labelLower = label.toLowerCase();

  if (editing) {
    return (
      <>
        <dt className={LABEL_CELL}>{label}</dt>
        <InlineInput
          value={value}
          placeholder={label}
          label={label}
          type={type}
          field={field}
          save={save}
          onChanged={onChanged}
          onDone={() => setEditing(false)}
        />
      </>
    );
  }

  const hasValue = value !== null && value !== "";
  return (
    <>
      <dt className={LABEL_CELL}>{label}</dt>
      <dd className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 border-b px-2.5 py-[7px]">
        {hasValue ? (
          <>
            {href ? (
              <a
                href={href}
                className="min-w-0 rounded-sm font-medium text-cyan-700 underline underline-offset-2 hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/50 outline-none dark:text-sky-300 [overflow-wrap:anywhere]"
                target={isWebsite ? "_blank" : undefined}
                rel={isWebsite ? "noopener noreferrer" : undefined}
              >
                {value}
              </a>
            ) : (
              <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
            )}
          </>
        ) : canEdit ? (
          <button
            type="button"
            aria-label={`Add ${labelLower}`}
            onClick={() => setEditing(true)}
            className="min-w-0 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10 pointer-coarse:inline-flex pointer-coarse:items-center"
          >
            Add
          </button>
        ) : (
          <span className="text-muted-foreground">Not set</span>
        )}
        {canEdit && hasValue ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Edit ${labelLower}`}
            title="Edit"
            onClick={() => setEditing(true)}
            className="ml-auto size-7 shrink-0 pointer-coarse:size-10"
          >
            <Pencil aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
      </dd>
    </>
  );
}

function TextRow({
  label,
  value,
  field,
  canEdit,
  save,
  onChanged,
  mode,
}: InlineRowProps<string> & { mode?: "numeric" | "text" }) {
  const [editing, setEditing] = useState(false);
  const labelLower = label.toLowerCase();

  if (editing) {
    return (
      <>
        <dt className={LABEL_CELL}>{label}</dt>
        <InlineInput
          value={value}
          placeholder={label}
          label={label}
          field={field}
          save={save}
          onChanged={onChanged}
          mode={mode}
          onDone={() => setEditing(false)}
        />
      </>
    );
  }

  const hasValue = value !== null && value !== "";
  return (
    <>
      <dt className={LABEL_CELL}>{label}</dt>
      <dd className="m-0 min-w-0 border-b">
        {canEdit ? (
          <button
            type="button"
            aria-label={hasValue ? `Edit ${labelLower}` : `Add ${labelLower}`}
            onClick={() => setEditing(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setEditing(true);
              }
            }}
            className="flex min-h-[34px] w-full items-center px-2.5 py-[7px] text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:min-h-10"
          >
            {hasValue ? (
              <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
            ) : (
              <span className="text-muted-foreground">Add</span>
            )}
          </button>
        ) : (
          <span className="block min-w-0 px-2.5 py-[7px] [overflow-wrap:anywhere]">
            {hasValue ? value : <span className="text-muted-foreground">Not set</span>}
          </span>
        )}
      </dd>
    </>
  );
}

function InlineInput({
  value,
  placeholder,
  label,
  type = "text",
  field,
  save,
  onChanged,
  mode,
  onDone,
}: {
  value: string | null;
  placeholder: string;
  label: string;
  type?: "text" | "email" | "tel" | "url";
  field: string;
  save: SaveField;
  onChanged: () => void;
  mode?: "numeric" | "text";
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function commit() {
    if (saving) return;
    const trimmed = draft.trim();
    const stored = value ?? "";
    if (trimmed === stored) {
      onDone();
      return;
    }
    setSaving(true);
    const patch = { [field]: trimmed === "" ? null : trimmed } as ContactUpdate;
    const result = await save(patch);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      inputRef.current?.focus();
      return;
    }
    onChanged();
    onDone();
  }

  return (
    <dd className="m-0 min-w-0 border-b" aria-busy={saving || undefined}>
      <Input
        ref={inputRef}
        type={type}
        inputMode={mode === "numeric" ? "numeric" : type === "email" ? "email" : type === "tel" ? "tel" : type === "url" ? "url" : undefined}
        autoComplete="off"
        maxLength={SHORT_MAX}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error !== null || undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={saving}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setDraft(value ?? "");
            setError(null);
            onDone();
          }
        }}
        className={cn(CELL_CONTROL)}
      />
      {error ? (
        <p id={errorId} role="alert" className="m-0 px-2.5 pb-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : (
        <p className="m-0 px-2.5 pb-1 text-[11.5px] text-muted-foreground">Enter to save, Esc to cancel.</p>
      )}
    </dd>
  );
}

/**
 * The person panel's Organization row: shows the organization as a link that
 * opens its panel when the viewer may see it, as plain text when not, or the
 * mockup's "No organization" muted line; the owner or an admin changes it with
 * the Add deal picker (ContactPicker), which sends the chosen contact through
 * `contactBody`. The link to the organization is built by the parent through
 * `panelHref`; here the row only reads the "visible" flag.
 */
function OrganizationRow({
  data,
  save,
  onChanged,
}: {
  data: PersonPanelData;
  save: SaveField;
  onChanged: () => void;
}) {
  const { person, canEdit } = data;
  const { organization } = person;
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<ContactChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const live = useRef(false);
  const typed = useRef(false);
  const refocus = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    } else if (refocus.current) {
      refocus.current = false;
      const active = document.activeElement;
      if (!active || active === document.body) changeRef.current?.focus();
    }
  }, [editing]);

  function start() {
    setChoice(organization ? existingChoice("organization", { id: organization.id, name: organization.name }) : null);
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
    const samePick =
      (next === null && organization === null) ||
      (next?.kind === "existing" && organization !== null && next.id === organization.id);
    if (samePick) {
      finish(true);
      return;
    }
    live.current = false;
    setSaving(true);
    const result = await save({ organization: contactBody(next) } as ContactUpdate);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      live.current = true;
      typed.current = false;
      return;
    }
    finish(true);
    onChanged();
  }

  if (editing) {
    return (
      <>
        <dt className={LABEL_CELL}>{PERSON_LABELS.organization}</dt>
        <dd
          className="m-0 min-w-0 border-b px-2 py-1.5"
          aria-busy={saving || undefined}
          onInputCapture={() => {
            typed.current = true;
          }}
          onKeyDownCapture={(event) => {
            if (event.key !== "Escape" || event.nativeEvent.isComposing || saving) return;
            event.preventDefault();
            event.stopPropagation();
            finish(true);
          }}
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            if (!typed.current && live.current && !saving) finish(false);
          }}
        >
          <div className="[&_label]:sr-only">
            <ContactPicker
              kind="organization"
              label={organization ? "Change organization" : "Add organization"}
              placeholder="Search or add a practice"
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
      </>
    );
  }

  return (
    <>
      <dt className={LABEL_CELL}>{PERSON_LABELS.organization}</dt>
      <dd className="m-0 flex min-w-0 flex-wrap items-center justify-between gap-x-2.5 gap-y-1 border-b px-2.5 py-[7px]">
        {organization ? (
          <span className="min-w-0 [overflow-wrap:anywhere]">{organization.name}</span>
        ) : (
          <span className="text-muted-foreground">No organization</span>
        )}
        {canEdit ? (
          <button
            ref={changeRef}
            type="button"
            aria-label={organization ? "Change organization" : "Add organization"}
            onClick={start}
            className="rounded-sm text-xs font-semibold text-cyan-700 underline underline-offset-2 outline-none hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-sky-300 pointer-coarse:-my-2.5 pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center"
          >
            {organization ? "Change" : "Add"}
          </button>
        ) : null}
      </dd>
    </>
  );
}
