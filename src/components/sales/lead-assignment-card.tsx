"use client";

import { useId } from "react";
import { TriangleAlert } from "lucide-react";

import type { LeadAssignmentView, SavedPersonView } from "@/lib/sales/settings";
import {
  type AssignmentDraft,
  lostAccessBar,
  lostRotationLine,
  nobodyTickedLine,
  personLabel,
} from "@/lib/sales/settings-client";
import { cn } from "@/lib/utils";
import { MUTED_TONE } from "@/components/sales/sales-pills";

// "Who gets new leads" card (Mockup v2): the two radios (take turns, or always
// give them to), the rotation's checkboxes with "No Sales access" pills for
// anyone who lost it, the single person select, and the inline error under
// each row. Pure UI around AssignmentDraft; the save bar sits in the parent.

const RADIO_ROW = "flex items-start gap-2 text-[14px] leading-tight";
const CHECKBOX_ROW =
  "flex flex-wrap items-center gap-2 pl-6 text-[14px] leading-tight pointer-coarse:min-h-10";
const LOST_PILL = cn(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
  MUTED_TONE,
);

type Props = {
  view: LeadAssignmentView;
  draft: AssignmentDraft;
  onDraftChange: (next: AssignmentDraft) => void;
  /** Shown as an alert under the single-person select or the single-person group. */
  inlineError: string | null;
};

export function LeadAssignmentCard({ view, draft, onDraftChange, inlineError }: Props) {
  const rrId = useId();
  const oneId = useId();
  const errorId = useId();

  const hasAccess = new Set(view.members.map((member) => member.id));
  // Build the rows we show on the rotation: every Sales member in order, plus
  // any saved rotation person who lost access (shown ticked and disabled).
  const extraLost = view.rotation.filter((person) => !hasAccess.has(person.id));
  const rotationRows: SavedPersonView[] = [
    ...view.members.map((member) => ({ id: member.id, name: member.name, hasAccess: true })),
    ...extraLost.map((person) => ({ ...person })),
  ];

  const bar = lostAccessBar(view);
  const rotationLost = draft.mode === "ROUND_ROBIN" ? lostRotationLine(view.rotation) : null;
  const eligible = draft.rotation.filter((id) => hasAccess.has(id));
  const nobodyTicked = draft.mode === "ROUND_ROBIN" && eligible.length === 0 ? nobodyTickedLine(view.firstAdminName) : null;

  function setMode(mode: "ROUND_ROBIN" | "SINGLE") {
    onDraftChange({ ...draft, mode });
  }

  function toggleRotation(id: string, next: boolean) {
    const without = draft.rotation.filter((other) => other !== id);
    const list = next ? [...without, id] : without;
    onDraftChange({ ...draft, rotation: list });
  }

  function setSingle(id: string) {
    onDraftChange({ ...draft, single: id === "" ? null : id });
  }

  const singleInvalid = inlineError !== null;

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {bar ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[13px] text-foreground">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
          <span>{bar}</span>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Who gets new leads</legend>

        <label htmlFor={rrId} className={RADIO_ROW}>
          <input
            id={rrId}
            type="radio"
            name="lead-assign-mode"
            className="mt-0.5 pointer-coarse:size-5"
            checked={draft.mode === "ROUND_ROBIN"}
            onChange={() => setMode("ROUND_ROBIN")}
          />
          <span>Take turns (round-robin) between:</span>
        </label>

        {draft.mode === "ROUND_ROBIN" ? (
          <div className="flex flex-col gap-1.5 pl-6">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {rotationRows.map((person) => {
                const ticked = draft.rotation.includes(person.id);
                const disabled = !person.hasAccess;
                return (
                  <label key={person.id} className={cn(CHECKBOX_ROW, disabled && "text-muted-foreground")}>
                    <input
                      type="checkbox"
                      className="size-4 pointer-coarse:size-5"
                      checked={ticked}
                      disabled={disabled}
                      onChange={(event) => toggleRotation(person.id, event.target.checked)}
                      aria-label={personLabel(person)}
                    />
                    <span>{personLabel(person)}</span>
                    {disabled ? <span className={LOST_PILL}>No Sales access</span> : null}
                  </label>
                );
              })}
            </div>
            {rotationLost ? (
              <p className="text-[12.5px] text-muted-foreground">{rotationLost}</p>
            ) : null}
            {nobodyTicked ? (
              <div role="status" className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[12.5px] text-foreground">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
                <span>{nobodyTicked}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <label htmlFor={oneId} className={RADIO_ROW}>
          <input
            id={oneId}
            type="radio"
            name="lead-assign-mode"
            className="mt-0.5 pointer-coarse:size-5"
            checked={draft.mode === "SINGLE"}
            onChange={() => setMode("SINGLE")}
          />
          <span>Always give them to:</span>
        </label>

        {draft.mode === "SINGLE" ? (
          <div className="flex flex-col gap-1.5 pl-6">
            <select
              aria-label="Person who gets every new lead"
              aria-invalid={singleInvalid || undefined}
              aria-describedby={singleInvalid ? errorId : undefined}
              value={draft.single ?? ""}
              onChange={(event) => setSingle(event.target.value)}
              className="h-9 w-auto min-w-[200px] rounded-md border bg-background px-2 text-[14px] pointer-coarse:h-10 aria-invalid:border-destructive"
            >
              {draft.single === null || !hasAccess.has(draft.single) ? (
                <option value="" disabled>
                  Pick a person
                </option>
              ) : null}
              {view.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {personLabel({ id: member.id, name: member.name, hasAccess: true })}
                </option>
              ))}
            </select>
            {inlineError ? (
              <p id={errorId} role="alert" className="text-[12.5px] font-medium text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
