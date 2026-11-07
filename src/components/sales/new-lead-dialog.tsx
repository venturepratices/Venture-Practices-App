"use client";

import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { createLeadRequest } from "@/lib/sales/api-client";
import type { SalesMemberOption } from "@/lib/sales/board";
import { DEAL_SOURCES, FIRST_ACTIVITY_PRESETS, HAND_MADE_SOURCE } from "@/lib/sales/constants";
import { shortName } from "@/lib/sales/format";
import type { AssignmentSummary } from "@/lib/sales/lead-assignment";
import { autoOwnerLine, newLeadToast } from "@/lib/sales/leads-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ContactChoice, contactBody, ContactPicker } from "@/components/sales/contact-picker";

// "Add lead" (Mockup v2 `#s=new-lead`, Decision 7), opened by "+ Lead", the
// empty Inbox's "Add a lead" or /sales/leads?new=1. Shaped like Add deal: a
// person or an organization (picked or new, at least one), the Source, the
// Practice ZIP, the owner (yourself; an admin may pick anyone in Sales or
// "Share out automatically", which follows Sales settings) and the first
// activity (spec rule 1).

type FirstActivity = keyof typeof FIRST_ACTIVITY_PRESETS;
type Source = (typeof DEAL_SOURCES)[number];

const NEED_CONTACT = "Add a person or an organization.";
/** The Owner choice that shares the lead out the way Sales settings say (admins only; the server's "auto"). */
const AUTO_OWNER = "auto";
/** Longest ZIP the box takes (Mockup v2); the server allows 20. */
const ZIP_MAX = 10;

const FIRST_ACTIVITY_ITEMS = Object.fromEntries(
  Object.entries(FIRST_ACTIVITY_PRESETS).map(([id, preset]) => [id, preset.label]),
) as Record<FirstActivity, string>;

const SOURCE_ITEMS = Object.fromEntries(DEAL_SOURCES.map((source) => [source, source])) as Record<Source, string>;

type Viewer = { userId: string; isAdmin: boolean };

export function NewLeadDialog({
  open,
  onOpenChange,
  members,
  viewer,
  assignment,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: SalesMemberOption[];
  viewer: Viewer;
  /** Who "Share out automatically" would give the lead to now. */
  assignment: AssignmentSummary;
  /** After the lead is saved (the dialog has closed and toasted). */
  onCreated: () => void;
}) {
  const personRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" initialFocus={personRef}>
        <NewLeadForm
          personRef={personRef}
          members={members}
          viewer={viewer}
          assignment={assignment}
          onCancel={() => onOpenChange(false)}
          onCreated={(otherOwnerName) => {
            onOpenChange(false);
            toast(newLeadToast(otherOwnerName));
            onCreated();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewLeadForm({
  personRef,
  members,
  viewer,
  assignment,
  onCancel,
  onCreated,
}: {
  personRef: React.RefObject<HTMLInputElement | null>;
  members: SalesMemberOption[];
  viewer: Viewer;
  assignment: AssignmentSummary;
  onCancel: () => void;
  /** With the owner's short name when an admin gave the lead to someone else by name, else null. */
  onCreated: (otherOwnerName: string | null) => void;
}) {
  const id = useId();
  const [person, setPerson] = useState<ContactChoice | null>(null);
  const [organization, setOrganization] = useState<ContactChoice | null>(null);
  const [source, setSource] = useState<Source>(HAND_MADE_SOURCE);
  const [zip, setZip] = useState("");
  const [ownerId, setOwnerId] = useState(viewer.userId);
  const [firstActivity, setFirstActivity] = useState<FirstActivity>("call-today");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = `${id}-error`;

  const label = (member: SalesMemberOption) =>
    member.id === viewer.userId ? `${shortName(member.name)} (you)` : shortName(member.name);
  // Someone who is not an admin adds leads for themselves only: the box shows them and stays shut.
  const ownerOptions = viewer.isAdmin ? members : members.filter((member) => member.id === viewer.userId);
  const ownerItems: Record<string, string> = Object.fromEntries(ownerOptions.map((member) => [member.id, label(member)]));
  if (!(viewer.userId in ownerItems)) ownerItems[viewer.userId] = "You";
  if (viewer.isAdmin) ownerItems[AUTO_OWNER] = "Share out automatically";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!person && !organization) {
      setError(NEED_CONTACT);
      personRef.current?.focus();
      return;
    }
    setError(null);
    setSaving(true);
    const trimmedZip = zip.trim();
    const result = await createLeadRequest({
      organization: contactBody(organization),
      person: contactBody(person),
      source,
      ...(trimmedZip ? { zip: trimmedZip } : {}),
      ownerId,
      firstActivity,
    });
    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }
    const other = ownerId !== viewer.userId && ownerId !== AUTO_OWNER ? members.find((member) => member.id === ownerId) : undefined;
    onCreated(other ? shortName(other.name) : null);
  }

  const onContact = (set: (choice: ContactChoice | null) => void) => (choice: ContactChoice | null) => {
    set(choice);
    if (choice) setError(null);
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Add lead</DialogTitle>
        <DialogDescription className="sr-only">
          Pick or type a person or an organization, then choose who owns it and the first activity.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 min-[400px]:grid-cols-2">
        <ContactPicker
          kind="person"
          label="Person"
          placeholder="Sarah K."
          inputRef={personRef}
          value={person}
          onChange={onContact(setPerson)}
        />
        <ContactPicker
          kind="organization"
          label="Organization"
          placeholder="Practice name"
          value={organization}
          onChange={onContact(setOrganization)}
        />
      </div>

      <div className="grid gap-3 min-[400px]:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <Label id={`${id}-source`} className="text-xs text-muted-foreground">
            Source
          </Label>
          <Select
            items={SOURCE_ITEMS}
            value={source}
            onValueChange={(next) => {
              const picked = DEAL_SOURCES.find((candidate) => candidate === next);
              if (picked) setSource(picked);
            }}
          >
            <SelectTrigger aria-labelledby={`${id}-source`} className="w-full pointer-coarse:h-10">
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
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-zip`} className="text-xs text-muted-foreground">
            Practice ZIP
          </Label>
          <Input
            id={`${id}-zip`}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={ZIP_MAX}
            placeholder="Optional"
            value={zip}
            onChange={(event) => setZip(event.target.value)}
            className="tabular-nums pointer-coarse:h-10"
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label id={`${id}-owner`} className="text-xs text-muted-foreground">
          Owner
        </Label>
        <Select
          items={ownerItems}
          value={ownerId}
          disabled={!viewer.isAdmin}
          onValueChange={(next) => typeof next === "string" && setOwnerId(next)}
        >
          <SelectTrigger
            aria-labelledby={`${id}-owner`}
            aria-describedby={ownerId === AUTO_OWNER ? `${id}-auto` : undefined}
            className="w-full pointer-coarse:h-10"
          >
            <SelectValue className="truncate" />
          </SelectTrigger>
          <SelectContent>
            {ownerOptions.map((member) => (
              <SelectItem key={member.id} value={member.id} className="pointer-coarse:min-h-10">
                {label(member)}
              </SelectItem>
            ))}
            {viewer.isAdmin ? (
              <SelectItem value={AUTO_OWNER} className="pointer-coarse:min-h-10">
                Share out automatically
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        {ownerId === AUTO_OWNER ? (
          <p id={`${id}-auto`} className="text-xs text-muted-foreground">
            {autoOwnerLine(assignment)}
          </p>
        ) : null}
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
