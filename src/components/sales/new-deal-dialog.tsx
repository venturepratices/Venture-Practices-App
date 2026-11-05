"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";

import { createDealRequest, searchContactsRequest } from "@/lib/sales/api-client";
import type { BoardPipeline, SalesMemberOption } from "@/lib/sales/board";
import { FIRST_ACTIVITY_PRESETS } from "@/lib/sales/constants";
import type { ContactResult } from "@/lib/sales/contacts";
import { parseMoneyToCents, shortName } from "@/lib/sales/format";
import { Button } from "@/components/ui/button";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DealsViewer } from "@/components/sales/deal-quick-actions";

// "Add deal" (mockup `newDealModal`), opened by "+ Deal", the `n` key or
// /sales/deals?new=1. A deal needs a person or an organization: pick an
// existing one from the search or type a new name. It starts in the pipeline's
// first stage with its first activity (spec rule 1), owned by you unless an
// admin picks someone else.

type FirstActivity = keyof typeof FIRST_ACTIVITY_PRESETS;

type ContactChoice =
  | { key: string; kind: "existing"; id: string; name: string; detail: string | null }
  | { key: "new"; kind: "new"; name: string };

const NEED_CONTACT = "Add a person or an organization.";
const MONEY_FORMAT = "Enter an amount like 14,400.";
const SEARCH_MIN = 2;
const SEARCH_DEBOUNCE_MS = 200;

const FIRST_ACTIVITY_ITEMS = Object.fromEntries(
  Object.entries(FIRST_ACTIVITY_PRESETS).map(([id, preset]) => [id, preset.label]),
) as Record<FirstActivity, string>;

export function NewDealDialog({
  open,
  onOpenChange,
  pipelines,
  currentPipelineId,
  members,
  viewer,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: BoardPipeline[];
  currentPipelineId: string;
  members: SalesMemberOption[];
  viewer: DealsViewer;
  /** After the deal is saved, with the key of the pipeline it went into. */
  onCreated: (pipelineKey: string) => void;
}) {
  const personRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" initialFocus={personRef}>
        <NewDealForm
          personRef={personRef}
          pipelines={pipelines}
          currentPipelineId={currentPipelineId}
          members={members}
          viewer={viewer}
          onCancel={() => onOpenChange(false)}
          onCreated={(pipelineKey) => {
            onOpenChange(false);
            toast("Deal added with its first activity.");
            onCreated(pipelineKey);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewDealForm({
  personRef,
  pipelines,
  currentPipelineId,
  members,
  viewer,
  onCancel,
  onCreated,
}: {
  personRef: React.RefObject<HTMLInputElement | null>;
  pipelines: BoardPipeline[];
  currentPipelineId: string;
  members: SalesMemberOption[];
  viewer: DealsViewer;
  onCancel: () => void;
  onCreated: (pipelineKey: string) => void;
}) {
  const id = useId();
  const [person, setPerson] = useState<ContactChoice | null>(null);
  const [organization, setOrganization] = useState<ContactChoice | null>(null);
  const [pipelineId, setPipelineId] = useState(currentPipelineId);
  const [ownerId, setOwnerId] = useState(viewer.userId);
  const [value, setValue] = useState("");
  const [firstActivity, setFirstActivity] = useState<FirstActivity>("call-today");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const valueRef = useRef<HTMLInputElement>(null);
  const errorId = `${id}-error`;

  const pipelineItems = Object.fromEntries(pipelines.map((pipeline) => [pipeline.id, pipeline.name]));
  const ownerItems = Object.fromEntries(members.map((member) => [member.id, shortName(member.name)]));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!person && !organization) {
      setError(NEED_CONTACT);
      personRef.current?.focus();
      return;
    }
    const valueCents = parseMoneyToCents(value);
    if (valueCents === null) {
      setError(MONEY_FORMAT);
      valueRef.current?.focus();
      return;
    }
    setError(null);
    setSaving(true);
    const result = await createDealRequest({
      pipelineId,
      ownerId,
      organization: contactBody(organization),
      person: contactBody(person),
      valueCents,
      firstActivity,
    });
    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }
    onCreated(result.data.deal.pipelineKey);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Add deal</DialogTitle>
        <DialogDescription className="sr-only">
          Pick or type a person or an organization, then choose the first activity.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 min-[400px]:grid-cols-2">
        <ContactPicker
          kind="person"
          label="Person"
          placeholder="Sarah K."
          inputRef={personRef}
          value={person}
          onChange={(choice) => {
            setPerson(choice);
            if (choice) setError(null);
          }}
        />
        <ContactPicker
          kind="organization"
          label="Organization"
          placeholder="Practice name"
          value={organization}
          onChange={(choice) => {
            setOrganization(choice);
            if (choice) setError(null);
          }}
        />
      </div>

      <div className="grid gap-3 min-[400px]:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <Label id={`${id}-pipeline`} className="text-xs text-muted-foreground">
            Pipeline
          </Label>
          <Select items={pipelineItems} value={pipelineId} onValueChange={(next) => typeof next === "string" && setPipelineId(next)}>
            <SelectTrigger aria-labelledby={`${id}-pipeline`} className="w-full pointer-coarse:h-10">
              <SelectValue className="truncate" />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((pipeline) => (
                <SelectItem key={pipeline.id} value={pipeline.id} className="pointer-coarse:min-h-10">
                  {pipeline.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label id={`${id}-owner`} className="text-xs text-muted-foreground">
            Owner
          </Label>
          <Select
            items={ownerItems}
            value={ownerId}
            disabled={!viewer.isAdmin}
            onValueChange={(next) => typeof next === "string" && setOwnerId(next)}
          >
            <SelectTrigger aria-labelledby={`${id}-owner`} className="w-full pointer-coarse:h-10">
              <SelectValue className="truncate" />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id} className="pointer-coarse:min-h-10">
                  {shortName(member.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-value`} className="text-xs text-muted-foreground">
          Value ($)
        </Label>
        <Input
          ref={valueRef}
          id={`${id}-value`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Optional until Proposal Sent"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error === MONEY_FORMAT || undefined}
          aria-describedby={error === MONEY_FORMAT ? errorId : undefined}
          className="tabular-nums pointer-coarse:h-10"
        />
      </div>

      <div className="grid gap-1.5">
        <Label id={`${id}-first`} className="text-xs text-muted-foreground">
          First activity
        </Label>
        <Select
          items={FIRST_ACTIVITY_ITEMS}
          value={firstActivity}
          onValueChange={(next) => {
            if (typeof next === "string" && next in FIRST_ACTIVITY_PRESETS) setFirstActivity(next as FirstActivity);
          }}
        >
          <SelectTrigger aria-labelledby={`${id}-first`} className="w-full pointer-coarse:h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FIRST_ACTIVITY_PRESETS) as FirstActivity[]).map((key) => (
              <SelectItem key={key} value={key} className="pointer-coarse:min-h-10">
                {FIRST_ACTIVITY_PRESETS[key].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="-mt-2 text-[0.8rem] text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} className="pointer-coarse:min-h-10">
          Cancel
        </Button>
        <Button type="submit" disabled={saving} className="pointer-coarse:min-h-10">
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The request's organization or person: an existing one by id, a new one by name, or none. */
function contactBody(choice: ContactChoice | null): { id: string } | { name: string } | null {
  if (!choice) return null;
  return choice.kind === "existing" ? { id: choice.id } : { name: choice.name };
}

function existingChoice(kind: "person" | "organization", result: ContactResult): ContactChoice {
  return { key: `${kind}:${result.id}`, kind: "existing", id: result.id, name: result.name, detail: result.organizationName ?? null };
}

/**
 * Search existing people or organizations (from two letters), or add a new one
 * by name: the last option is always "Add new person: {text}". Leaving the box
 * with a typed name and nothing picked keeps what was typed (an exact match
 * becomes that existing one), as the mockup's plain text box would.
 */
function ContactPicker({
  kind,
  label,
  placeholder,
  inputRef,
  value,
  onChange,
}: {
  kind: "person" | "organization";
  label: string;
  placeholder: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  value: ContactChoice | null;
  onChange: (choice: ContactChoice | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [found, setFound] = useState<ContactResult[]>([]);
  const query = text.trim();

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
        itemToStringLabel={(choice) => choice.name}
        isItemEqualToValue={(a, b) => a.key === b.key}
        onValueChange={(choice) => onChange(choice ?? null)}
        onInputValueChange={(next) => setText(next)}
        onOpenChange={(isOpen, details) => {
          if (isOpen || details.reason === "item-press") return;
          if (!query) {
            if (value) onChange(null);
            return;
          }
          if (value && value.name === query) return;
          const exact = results.find((result) => result.name.toLowerCase() === query.toLowerCase());
          onChange(exact ? existingChoice(kind, exact) : { key: "new", kind: "new", name: query });
        }}
      >
        <ComboboxInputGroup className="pointer-coarse:h-10">
          <ComboboxInput ref={inputRef} id={`${id}-input`} placeholder={placeholder} autoComplete="off" className="pr-8" />
          <div className="absolute right-1 flex items-center">
            <ComboboxTrigger aria-label={`Show ${noun} matches`} className="pointer-coarse:size-8">
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
                      <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{choice.detail}</span>
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
