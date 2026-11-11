"use client";

import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { createDealRequest } from "@/lib/sales/api-client";
import type { BoardPipeline, SalesMemberOption } from "@/lib/sales/board";
import { FIRST_ACTIVITY_PRESETS } from "@/lib/sales/constants";
import { parseMoneyToCents, shortName } from "@/lib/sales/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ContactChoice, contactBody, ContactPicker } from "@/components/sales/contact-picker";
import type { DealsViewer } from "@/components/sales/deal-quick-actions";

// "Add deal" (mockup `newDealModal`), opened by "+ Deal", the `n` key or
// /sales/deals?new=1. A deal needs a person or an organization: pick an
// existing one from the search or type a new name (the shared ContactPicker).
// It starts in the pipeline's first stage with its first activity (spec rule
// 1), owned by you unless an admin picks someone else.

type FirstActivity = keyof typeof FIRST_ACTIVITY_PRESETS;

const NEED_CONTACT = "Add a person or an organization.";
const MONEY_FORMAT = "Enter an amount like 14,400.";

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

