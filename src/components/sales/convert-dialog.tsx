"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  convertLeadRequest,
  convertLeadsRequest,
  getConvertTargets,
  getDealPanel,
  getLeadPanel,
} from "@/lib/sales/api-client";
import { checkDealValues } from "@/lib/sales/board-client";
import {
  convertButtonLabel,
  convertTargetsState,
  convertTitle,
  convertToast,
  moveLine,
  pricedStagesNote,
  skippedLine,
  stagePriceLine,
  takenLine,
  usableTargets,
  whyLine,
} from "@/lib/sales/convert-client";
import { parseMoneyToCents } from "@/lib/sales/format";
import type { ConvertTarget } from "@/lib/sales/lead-convert";
import { bulkFailureLine } from "@/lib/sales/leads-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { contactBody, type ContactChoice, ContactPicker } from "@/components/sales/contact-picker";
import { NoticeBar } from "@/components/sales/deal-panel";

// "Convert to deal" for one lead and "Convert leads to deals" for several
// (Mockup v2 `#s=lead-convert`, `#s=lead-convert-proposal`,
// `#s=lead-convert-pickers`, `#s=leads-bulk-convert`, `#s=lead-convert-taken`;
// Decisions 14 and 15). Pipeline and Stage come from the server when the
// dialog opens. One lead shows its own person and organization (or the Add
// deal pickers when it has neither), an optional value, or Total and Monthly
// when the stage needs a price, and what moves to the deal. Several take a
// pipeline and stage only, skip the leads with no contact and say so. The
// dialog toasts what happened; the caller moves on (`onConverted`).

export type ConvertLead = {
  id: string;
  title: string;
  personName: string | null;
  organizationName: string | null;
  /** The lead's open activities, soonest first, when the caller has them (the move line names them). */
  openActivities?: readonly { subject: string; dueAt: string }[];
};

export type ConvertResult = { dealId: string | null; pipelineName: string; converted: number };

type Load = "loading" | "error" | { targets: ConvertTarget[] };

/** The lead had become a deal already (409): which one, when this person may open it. */
type Taken = { message: string; deal: { id: string; title: string } | null; pipelineName: string | null };

type FormError = { message: string; on: "contact" | "value" | "total" | "monthly" | "both" | null };

const NEED_CONTACT = "Add a person or an organization.";
const AMOUNT_FORMAT = "Enter an amount like 14,400.";
const BULK_MOVE_LINE = "Open activities and notes move with each lead. A lead with no next step gets a first call for today.";

const hasContact = (lead: ConvertLead) => lead.personName !== null || lead.organizationName !== null;

export function ConvertDialog({
  open,
  onOpenChange,
  leads,
  onConverted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: ConvertLead[];
  onConverted: (result: ConvertResult) => void;
}) {
  const [saving, setSaving] = useState(false);

  return (
    // While a convert is on its way the dialog stays, so its answer has somewhere to show.
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[480px]">
        <ConvertForm
          leads={leads}
          saving={saving}
          setSaving={setSaving}
          onCancel={() => onOpenChange(false)}
          onDone={(result) => {
            onOpenChange(false);
            onConverted(result);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConvertForm({
  leads,
  saving,
  setSaving,
  onCancel,
  onDone,
}: {
  leads: ConvertLead[];
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onCancel: () => void;
  onDone: (result: ConvertResult) => void;
}) {
  const id = useId();
  const single = leads.length === 1;
  const lead = leads[0];
  const ready = leads.filter(hasContact);
  const skipped = leads.filter((candidate) => !hasContact(candidate));
  // One lead with neither a person nor an organization picks them here (A1).
  const askContacts = single && !hasContact(lead);

  const [load, setLoad] = useState<Load>("loading");
  const [attempt, setAttempt] = useState(0);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [person, setPerson] = useState<ContactChoice | null>(null);
  const [organization, setOrganization] = useState<ContactChoice | null>(null);
  const [value, setValue] = useState("");
  const [total, setTotal] = useState("");
  const [monthly, setMonthly] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [taken, setTaken] = useState<Taken | null>(null);
  const personRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const totalRef = useRef<HTMLInputElement>(null);
  const monthlyRef = useRef<HTMLInputElement>(null);
  const errorId = `${id}-error`;

  useEffect(() => {
    let cancelled = false;
    void getConvertTargets().then((result) => {
      if (!cancelled) setLoad(result.ok ? { targets: result.data.targets } : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const targets = typeof load === "object" ? usableTargets(load.targets, !single) : [];
  const state = convertTargetsState(typeof load === "object" ? { targets } : load);
  const pipeline = targets.find((target) => target.id === pipelineId) ?? targets[0] ?? null;
  const stage = pipeline?.stages.find((option) => option.id === stageId) ?? pipeline?.stages[0] ?? null;
  const needsValue = single && stage?.requiresValue === true;
  // Bulk leaves out the stages that need a price; say which, for the pipeline picked.
  const pricedNote =
    !single && typeof load === "object" && pipeline
      ? pricedStagesNote(
          (load.targets.find((target) => target.id === pipeline.id)?.stages ?? [])
            .filter((option) => option.requiresValue)
            .map((option) => option.name),
        )
      : null;
  const now = new Date();

  const pipelineItems = Object.fromEntries(targets.map((target) => [target.id, target.name]));
  const stageItems = Object.fromEntries((pipeline?.stages ?? []).map((option) => [option.id, option.name]));

  function retry() {
    setLoad("loading");
    setAttempt((count) => count + 1);
  }

  /** A 409 on one lead: read it again, and if it is a deal now, say which. Anything else shows as it came. */
  async function explainConflict(message: string) {
    const again = await getLeadPanel(lead.id);
    if (!again.ok || again.data.lead.status !== "CONVERTED") {
      setError({ message, on: null });
      return;
    }
    const deal = again.data.convertedDeal;
    const dealPanel = deal ? await getDealPanel(deal.id) : null;
    setTaken({ message, deal, pipelineName: dealPanel?.ok ? dealPanel.data.pipeline.name : null });
  }

  async function convertOne() {
    if (!pipeline || !stage) return;
    if (askContacts && !person && !organization) {
      setError({ message: NEED_CONTACT, on: "contact" });
      personRef.current?.focus();
      return;
    }
    let values: { valueCents?: number; mrrCents?: number } = {};
    if (needsValue) {
      const check = checkDealValues(total, monthly, true);
      if (!check.ok) {
        const on = check.invalid.total && check.invalid.monthly ? "both" : check.invalid.total ? "total" : "monthly";
        setError({ message: check.message, on });
        (check.invalid.total ? totalRef : monthlyRef).current?.focus();
        return;
      }
      values = check.values;
    } else {
      const cents = parseMoneyToCents(value);
      if (cents === null) {
        setError({ message: AMOUNT_FORMAT, on: "value" });
        valueRef.current?.focus();
        return;
      }
      if (cents > 0) values = { valueCents: cents };
    }

    setError(null);
    setSaving(true);
    const result = await convertLeadRequest(lead.id, {
      pipelineId: pipeline.id,
      stageId: stage.id,
      ...(askContacts ? { organization: contactBody(organization), person: contactBody(person) } : {}),
      ...values,
    });
    if (!result.ok) {
      if (result.status === 409) await explainConflict(result.error);
      else setError({ message: result.error, on: null });
      setSaving(false);
      return;
    }
    setSaving(false);
    toast(convertToast(1, result.data.deal.pipelineName));
    onDone({ dealId: result.data.deal.id, pipelineName: result.data.deal.pipelineName, converted: 1 });
  }

  async function convertMany() {
    if (!pipeline || !stage || ready.length === 0) return;
    setError(null);
    setSaving(true);
    const result = await convertLeadsRequest({ ids: ready.map((candidate) => candidate.id), pipelineId: pipeline.id, stageId: stage.id });
    setSaving(false);
    if (!result.ok) {
      setError({ message: result.error, on: null });
      return;
    }
    const converted = result.data.results.filter((entry) => entry.ok).length;
    if (converted > 0) toast(convertToast(converted, result.data.pipeline.name));
    const failure = bulkFailureLine(result.data.results);
    if (failure) toast.error(failure);
    onDone({ dealId: null, pipelineName: result.data.pipeline.name, converted });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    void (single ? convertOne() : convertMany());
  }

  if (taken) {
    const deal = taken.deal;
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{convertTitle(1)}</DialogTitle>
        </DialogHeader>
        <div role="alert">
          <NoticeBar tone="danger" icon={TriangleAlert}>
            <strong className="font-semibold">{taken.message}</strong>
          </NoticeBar>
        </div>
        {deal ? <p className="m-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">{takenLine(deal.title, taken.pipelineName)}</p> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onDone({ dealId: null, pipelineName: taken.pipelineName ?? "", converted: 0 })}
            className="pointer-coarse:min-h-10"
          >
            Close
          </Button>
          {deal ? (
            <Button
              type="button"
              onClick={() => onDone({ dealId: deal.id, pipelineName: taken.pipelineName ?? "", converted: 0 })}
              className="pointer-coarse:min-h-10"
            >
              Open the deal
            </Button>
          ) : null}
        </DialogFooter>
      </div>
    );
  }

  const listsOff = state.kind !== "ready" || saving;
  const skippedText = skippedLine(skipped.map((candidate) => candidate.title));
  const skippedHead = "Add a person or an organization first:";
  const fieldError = (on: FormError["on"]) => error !== null && (error.on === on || (error.on === "both" && (on === "total" || on === "monthly")));

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{convertTitle(leads.length)}</DialogTitle>
        {single ? null : (
          <DialogDescription className="[overflow-wrap:anywhere]">{whyLine(ready.map((candidate) => candidate.title))}</DialogDescription>
        )}
      </DialogHeader>

      {!single && skippedText ? (
        <NoticeBar tone="warning" icon={TriangleAlert} alignTop>
          <strong className="font-semibold">{skippedHead}</strong>
          {skippedText.slice(skippedHead.length)}
        </NoticeBar>
      ) : null}

      {single && !askContacts ? (
        <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] overflow-hidden rounded-[9px] border text-[13px] [&>:nth-last-child(-n+2)]:border-b-0">
          <dt className="border-b bg-muted/40 px-2.5 py-[7px] text-muted-foreground">Person</dt>
          <dd className="m-0 min-w-0 border-b px-2.5 py-[7px] break-words">{lead.personName ?? <span className="text-muted-foreground">None</span>}</dd>
          <dt className="border-b bg-muted/40 px-2.5 py-[7px] text-muted-foreground">Organization</dt>
          <dd className="m-0 min-w-0 border-b px-2.5 py-[7px] break-words">{lead.organizationName ?? <span className="text-muted-foreground">None</span>}</dd>
        </dl>
      ) : null}

      {askContacts ? (
        <div className="grid gap-2">
          <p className="m-0 text-sm text-muted-foreground">This lead has no person or organization yet. Add at least one.</p>
          <div className="grid gap-3 min-[400px]:grid-cols-2">
            <ContactPicker
              kind="person"
              label="Person"
              placeholder="Sarah K."
              inputRef={personRef}
              value={person}
              onChange={(choice) => {
                setPerson(choice);
                if (choice && error?.on === "contact") setError(null);
              }}
              disabled={saving}
            />
            <ContactPicker
              kind="organization"
              label="Organization"
              placeholder="Practice name"
              value={organization}
              onChange={(choice) => {
                setOrganization(choice);
                if (choice && error?.on === "contact") setError(null);
              }}
              disabled={saving}
            />
          </div>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <div className="grid gap-3 min-[400px]:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label id={`${id}-pipeline`} className="text-xs text-muted-foreground">
              Pipeline
            </Label>
            <Select
              items={pipelineItems}
              value={pipeline?.id ?? null}
              disabled={listsOff}
              onValueChange={(next) => {
                if (typeof next !== "string" || next === pipeline?.id) return;
                setPipelineId(next);
                // A new pipeline starts on its own first stage.
                setStageId(null);
                setError(null);
              }}
            >
              <SelectTrigger aria-labelledby={`${id}-pipeline`} className="w-full pointer-coarse:h-10">
                <SelectValue className="truncate" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((target) => (
                  <SelectItem key={target.id} value={target.id} className="pointer-coarse:min-h-10">
                    {target.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label id={`${id}-stage`} className="text-xs text-muted-foreground">
              Stage
            </Label>
            <Select
              items={stageItems}
              value={stage?.id ?? null}
              disabled={listsOff}
              onValueChange={(next) => {
                if (typeof next !== "string") return;
                setStageId(next);
                setError(null);
              }}
            >
              <SelectTrigger aria-labelledby={`${id}-stage`} className="w-full pointer-coarse:h-10">
                <SelectValue className="truncate" />
              </SelectTrigger>
              <SelectContent>
                {(pipeline?.stages ?? []).map((option) => (
                  <SelectItem key={option.id} value={option.id} className="pointer-coarse:min-h-10">
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {state.kind === "loading" ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            {state.text}
          </p>
        ) : state.kind === "error" ? (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>{state.text}</span>
            <Button type="button" variant="link" size="sm" onClick={retry} className="h-auto px-0 text-xs pointer-coarse:min-h-10">
              {state.action}
            </Button>
          </div>
        ) : state.kind === "empty" ? (
          <p className="m-0 text-xs text-muted-foreground">{state.text}</p>
        ) : null}
      </div>

      {single ? (
        needsValue && stage ? (
          <div className="grid gap-1.5">
            <p className="m-0 text-sm text-muted-foreground">{stagePriceLine(stage.name)}</p>
            <div className="grid gap-3 min-[400px]:grid-cols-2">
              <MoneyField
                id={`${id}-total`}
                label="Total value ($)"
                placeholder="14400"
                inputRef={totalRef}
                value={total}
                onChange={setTotal}
                invalid={fieldError("total")}
                errorId={errorId}
              />
              <MoneyField
                id={`${id}-monthly`}
                label="Monthly value ($)"
                placeholder="1200"
                inputRef={monthlyRef}
                value={monthly}
                onChange={setMonthly}
                invalid={fieldError("monthly")}
                errorId={errorId}
              />
            </div>
          </div>
        ) : (
          <MoneyField
            id={`${id}-value`}
            label="Value ($)"
            placeholder="Optional"
            inputRef={valueRef}
            value={value}
            onChange={setValue}
            invalid={fieldError("value")}
            errorId={errorId}
          />
        )
      ) : null}

      {single ? null : pricedNote ? <p className="m-0 text-sm text-muted-foreground">{pricedNote}</p> : null}

      <NoticeBar tone="info" icon={CalendarCheck} alignTop>
        {single ? moveLine(lead.openActivities ?? [], now) : BULK_MOVE_LINE}
      </NoticeBar>

      {error ? (
        <p id={errorId} role="alert" className="-mt-1 text-[0.8rem] text-destructive">
          {error.message}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving} className="pointer-coarse:min-h-10">
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={saving || state.kind !== "ready" || (!single && ready.length === 0)}
          className="pointer-coarse:min-h-10"
        >
          {convertButtonLabel(single ? 1 : ready.length, single)}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A dollar box with its label above it, marked when the message under the form is about it. */
function MoneyField({
  id,
  label,
  placeholder,
  inputRef,
  value,
  onChange,
  invalid,
  errorId,
}: {
  id: string;
  label: string;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  errorId: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        ref={inputRef}
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className="tabular-nums pointer-coarse:h-10"
      />
    </div>
  );
}
