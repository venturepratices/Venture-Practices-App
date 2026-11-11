"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { setDealFieldRequest, updateDealRequest, type ApiResult } from "@/lib/sales/api-client";
import { DEAL_SOURCES } from "@/lib/sales/constants";
import { normalizeFieldValue } from "@/lib/sales/custom-fields";
import type { DealPanelData, PanelField } from "@/lib/sales/deal-panel";
import { formatMoney } from "@/lib/sales/format";
import { cn, formatDate, startOfDay } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContactCell } from "@/components/sales/lead-details";
import { SECTION_HEADING } from "@/components/sales/next-steps";

// The panel's "Details" (mockup `.fields`): a two-column label and value grid
// (150px labels, 120px on phones). Organization and person are shown, not
// edited, in Plan 2 (Decision 25). Source and the custom fields save on their
// own when changed: text, numbers and dates when the box is left (or Enter),
// lists when a choice is picked. Each value is checked here first with the
// same rule the server uses, and a problem shows under its field.

const NOT_SET = "__none__";

/** A value cell's control: borderless inside the grid, tinted on hover, ringed inside on focus. Shared with the lead panel's Details. */
export const CELL_CONTROL =
  "h-auto min-h-[34px] w-full rounded-none border-0 bg-transparent px-2.5 py-[7px] text-base shadow-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset md:text-[13px] disabled:cursor-default disabled:bg-transparent disabled:opacity-100 dark:bg-transparent dark:disabled:bg-transparent pointer-coarse:min-h-10";

export const LABEL_CELL = "border-b bg-muted/40 px-2.5 py-[7px] text-muted-foreground";

export function DealDetails({
  data,
  onSaved,
  onEditValue,
}: {
  data: DealPanelData;
  /** After a value is saved: reload the panel. */
  onSaved: () => void;
  /** Opens the "Deal value" dialog. */
  onEditValue: () => void;
}) {
  const { deal, fields, canEdit } = data;
  const id = useId();

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-2">
      <h3 id={`${id}-heading`} className={SECTION_HEADING}>
        Details
      </h3>
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] overflow-hidden rounded-[9px] border text-[13px] sm:grid-cols-[150px_minmax(0,1fr)] [&>:nth-last-child(-n+2)]:border-b-0">
        <dt className={LABEL_CELL}>Organization</dt>
        <ContactCell
          kind="organization"
          contact={deal.organization}
          canEdit={canEdit}
          save={(ref) => updateDealRequest(deal.id, { organization: ref })}
          onSaved={onSaved}
        />

        <dt className={LABEL_CELL}>Person</dt>
        <ContactCell
          kind="person"
          contact={deal.person}
          canEdit={canEdit}
          save={(ref) => updateDealRequest(deal.id, { person: ref })}
          onSaved={onSaved}
        />

        <dt className={LABEL_CELL} id={`${id}-source`}>
          Source
        </dt>
        <dd className="m-0 min-w-0 border-b">
          <SourceSelect dealId={deal.id} source={deal.source} canEdit={canEdit} labelId={`${id}-source`} onSaved={onSaved} />
        </dd>

        <dt className={LABEL_CELL}>Monthly value</dt>
        <dd className="m-0 min-w-0 border-b">
          <button
            type="button"
            onClick={onEditValue}
            disabled={!canEdit}
            aria-disabled={!canEdit || undefined}
            aria-label={deal.mrrCents > 0 ? `Monthly value ${formatMoney(deal.mrrCents)}, edit value` : "Add the monthly value"}
            className="flex min-h-[34px] w-full items-center px-2.5 py-[7px] text-left tabular-nums outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default disabled:hover:bg-transparent pointer-coarse:min-h-10"
          >
            {deal.mrrCents > 0 ? (
              formatMoney(deal.mrrCents)
            ) : (
              <span className="text-muted-foreground">{canEdit ? "Add" : "Not set"}</span>
            )}
          </button>
        </dd>

        <dt className={LABEL_CELL} id={`${id}-close`}>
          Expected close
        </dt>
        <dd className="m-0 min-w-0 border-b">
          <ExpectedCloseInput
            dealId={deal.id}
            value={deal.expectedCloseDate}
            canEdit={canEdit}
            labelId={`${id}-close`}
            onSaved={onSaved}
          />
        </dd>

        {fields.map((field) => (
          <CustomFieldRow
            key={field.key}
            field={field}
            canEdit={canEdit}
            save={(fieldKey, value) => setDealFieldRequest(deal.id, fieldKey, value)}
            onSaved={onSaved}
          />
        ))}
      </dl>
    </section>
  );
}

/**
 * The Expected close row (Mockup v2 `d-close`): the stored day as a short date
 * (or "Add" when none is set), with a click or Enter to open a native date
 * input and save on blur. The hint under the box names the forecast on the
 * Sales dashboard (Decision 26). A view-only cell for a reader.
 */
function ExpectedCloseInput({
  dealId,
  value,
  canEdit,
  labelId,
  onSaved,
}: {
  dealId: string;
  value: string | null;
  canEdit: boolean;
  labelId: string;
  onSaved: () => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A reload brought a different stored value: refresh the box without remounting (so focus stays put).
  const [stored, setStored] = useState(value);
  if (value !== stored) {
    setStored(value);
    setDraft(value ?? "");
  }

  async function commit(raw: string) {
    const next = raw === "" ? null : raw;
    if (next === (value ?? null) || saving) {
      setEditing(false);
      return;
    }
    setError(null);
    setSaving(true);
    const result = await updateDealRequest(dealId, { expectedCloseDate: next });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      setDraft(value ?? "");
      return;
    }
    toast("Saved.");
    setEditing(false);
    onSaved();
  }

  const dateLabel = value ? formatDate(startOfDay(value), { month: "short", day: "numeric", year: "numeric" }) : null;

  if (!canEdit) {
    return (
      <div className="flex min-h-[34px] items-center px-2.5 py-[7px]">
        {dateLabel ? (
          <span className="tabular-nums">{dateLabel}</span>
        ) : (
          <span className="text-muted-foreground">Not set</span>
        )}
      </div>
    );
  }

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  if (editing) {
    return (
      <div aria-busy={saving || undefined}>
        <Input
          id={id}
          type="date"
          aria-labelledby={labelId}
          aria-invalid={error !== null || undefined}
          aria-describedby={error ? errorId : hintId}
          value={draft}
          autoFocus
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onBlur={() => void commit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(value ?? "");
              setError(null);
              setEditing(false);
            }
          }}
          className={cn(CELL_CONTROL, "tabular-nums", draft === "" && "text-muted-foreground")}
        />
        {error ? (
          <p id={errorId} role="alert" className="m-0 px-2.5 pb-1.5 text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p id={hintId} className="m-0 px-2.5 pb-1.5 text-xs text-muted-foreground">
            Used by the forecast on the Sales dashboard.
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-labelledby={labelId}
      aria-label={dateLabel ? `Expected close ${dateLabel}, change` : "Add an expected close date"}
      onClick={() => setEditing(true)}
      className="flex min-h-[34px] w-full items-center px-2.5 py-[7px] text-left tabular-nums outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset pointer-coarse:min-h-10"
    >
      {dateLabel ?? <span className="text-muted-foreground">Add</span>}
    </button>
  );
}

function SourceSelect({
  dealId,
  source,
  canEdit,
  labelId,
  onSaved,
}: {
  dealId: string;
  source: string | null;
  canEdit: boolean;
  labelId: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(source ?? NOT_SET);
  // A reload brought a different stored source: show it (without remounting, so focus stays on the list).
  const [stored, setStored] = useState(source);
  if (source !== stored) {
    setStored(source);
    setValue(source ?? NOT_SET);
  }
  const items = { [NOT_SET]: "Not set", ...Object.fromEntries(DEAL_SOURCES.map((option) => [option, option])) };

  async function change(next: unknown) {
    if (typeof next !== "string" || next === value) return;
    const previous = value;
    setValue(next);
    const picked = next === NOT_SET ? null : DEAL_SOURCES.find((option) => option === next);
    if (picked === undefined) return;
    const result = await updateDealRequest(dealId, { source: picked });
    if (!result.ok) {
      setValue(previous);
      toast.error(result.error);
      return;
    }
    onSaved();
  }

  return (
    <Select items={items} value={value === NOT_SET ? null : value} onValueChange={(next) => void change(next ?? NOT_SET)} disabled={!canEdit}>
      <SelectTrigger aria-labelledby={labelId} aria-disabled={!canEdit || undefined} className={cn(CELL_CONTROL, "justify-between")}>
        <SelectValue placeholder={canEdit ? "Add" : "Not set"} className="truncate" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOT_SET} className="pointer-coarse:min-h-10">
          Not set
        </SelectItem>
        {DEAL_SOURCES.map((option) => (
          <SelectItem key={option} value={option} className="pointer-coarse:min-h-10">
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One custom field: its label and the control for its type, with a problem
 * shown under it. `save` sends the checked value to the deal's or the lead's
 * field route (the lead panel's Details use it too).
 */
export function CustomFieldRow({
  field,
  canEdit,
  save,
  onSaved,
}: {
  field: PanelField;
  canEdit: boolean;
  save: (fieldKey: string, value: string | null) => Promise<ApiResult<unknown>>;
  onSaved: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(field.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A reload brought a different stored value: start the box from it (without remounting, so focus stays put).
  const [stored, setStored] = useState(field.value);
  if (field.value !== stored) {
    setStored(field.value);
    setDraft(field.value ?? "");
  }
  const errorId = `${id}-error`;
  const placeholder = canEdit ? "Add" : "Not set";

  async function commit(raw: string) {
    const checked = normalizeFieldValue(field, raw);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    if (checked.value === field.value || saving) return;
    setSaving(true);
    const result = await save(field.key, checked.value);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape" && draft !== (field.value ?? "")) {
      // Esc puts the stored value back; a second Esc closes the panel.
      event.preventDefault();
      event.stopPropagation();
      setDraft(field.value ?? "");
      setError(null);
    }
  }

  const invalid = error !== null;
  const describedBy = invalid ? errorId : undefined;

  let control: React.ReactNode;
  if (field.fieldType === "SELECT") {
    const items = { [NOT_SET]: "Not set", ...Object.fromEntries(field.options.map((option) => [option, option])) };
    control = (
      <Select
        items={items}
        value={draft === "" ? null : draft}
        disabled={!canEdit}
        onValueChange={(next) => {
          const text = typeof next === "string" && next !== NOT_SET ? next : "";
          setDraft(text);
          void commit(text);
        }}
      >
        <SelectTrigger
          aria-labelledby={`${id}-label`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-disabled={!canEdit || undefined}
          className={cn(CELL_CONTROL, "justify-between")}
        >
          <SelectValue placeholder={placeholder} className="truncate" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NOT_SET} className="pointer-coarse:min-h-10">
            Not set
          </SelectItem>
          {field.options.map((option) => (
            <SelectItem key={option} value={option} className="pointer-coarse:min-h-10">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else {
    control = (
      <Input
        id={`${id}-input`}
        type={field.fieldType === "DATE" ? "date" : "text"}
        inputMode={field.fieldType === "NUMBER" ? "decimal" : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={draft}
        disabled={!canEdit}
        aria-disabled={!canEdit || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onBlur={() => void commit(draft)}
        onKeyDown={onKeyDown}
        className={cn(CELL_CONTROL, field.fieldType === "NUMBER" && "tabular-nums", field.fieldType === "DATE" && draft === "" && "text-muted-foreground")}
      />
    );
  }

  return (
    <>
      <dt className={cn(LABEL_CELL, "break-words")} id={`${id}-label`}>
        {field.fieldType === "SELECT" ? field.label : <label htmlFor={`${id}-input`}>{field.label}</label>}
      </dt>
      <dd className="m-0 min-w-0 border-b" aria-busy={saving || undefined}>
        {control}
        {error ? (
          <p id={errorId} role="alert" className="m-0 px-2.5 pb-1.5 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </dd>
    </>
  );
}
