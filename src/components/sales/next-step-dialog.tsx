"use client";

import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { createActivityFor, type SalesParentRef } from "@/lib/sales/api-client";
import { NEXT_STEP_PRESETS } from "@/lib/sales/constants";
import { addDaysToDateString, todayDateString } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACTIVITY_ICONS } from "@/components/sales/sales-pills";

// "Schedule the next step" (mockup `askNext`): shown after the last open to-do
// on an open deal or lead is ticked done, so it never sits with nothing
// planned (spec rule 1). Three quick choices, "Call tomorrow" picked; "Skip for
// now" just closes. The day is counted from today in app time at the moment of
// the click.

type Parent = SalesParentRef & { title: string };

export function NextStepDialog({
  open,
  onOpenChange,
  parent,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The deal or lead the next step goes on. */
  parent: Parent;
  /** Called after the activity is saved (a refresh of whatever shows the deal or lead). */
  onScheduled: () => void;
}) {
  const firstChoiceRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" initialFocus={firstChoiceRef}>
        <NextStepForm
          firstChoiceRef={firstChoiceRef}
          parent={parent}
          onCancel={() => onOpenChange(false)}
          onDone={() => {
            onOpenChange(false);
            toast("Next step scheduled.");
            onScheduled();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// Lives inside the popup, which unmounts on close, so every opening starts on
// "Call tomorrow" with no old error.
function NextStepForm({
  firstChoiceRef,
  parent,
  onCancel,
  onDone,
}: {
  firstChoiceRef: React.RefObject<HTMLInputElement | null>;
  parent: Parent;
  onCancel: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState(NEXT_STEP_PRESETS[0].id);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = `${id}-error`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const preset = NEXT_STEP_PRESETS.find((option) => option.id === choice) ?? NEXT_STEP_PRESETS[0];
    setError(null);
    setSaving(true);
    const result = await createActivityFor(parent, {
      type: preset.type,
      subject: preset.subject,
      dueDate: addDaysToDateString(todayDateString(), preset.offsetDays),
      dueTime: null,
    });
    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Schedule the next step</DialogTitle>
        <DialogDescription>{parent.title} has no next activity now. Pick one so it does not stall.</DialogDescription>
      </DialogHeader>

      <fieldset className="grid gap-1.5" aria-describedby={error ? errorId : undefined}>
        <legend className="sr-only">Next step</legend>
        {NEXT_STEP_PRESETS.map((preset, index) => {
          const Icon = ACTIVITY_ICONS[preset.type];
          return (
            <label
              key={preset.id}
              className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[13px] transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
            >
              <input
                ref={index === 0 ? firstChoiceRef : undefined}
                type="radio"
                name={`${id}-next`}
                value={preset.id}
                checked={choice === preset.id}
                onChange={() => setChoice(preset.id)}
                className="size-4 shrink-0 accent-primary"
              />
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              {preset.label}
            </label>
          );
        })}
      </fieldset>

      {error ? (
        <p id={errorId} role="alert" className="-mt-2 text-[0.8rem] text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} className="pointer-coarse:min-h-10">
          Skip for now
        </Button>
        <Button type="submit" disabled={saving} className="pointer-coarse:min-h-10">
          Schedule
        </Button>
      </DialogFooter>
    </form>
  );
}
