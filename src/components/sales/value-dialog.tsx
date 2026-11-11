"use client";

import { useId, useRef, useState } from "react";

import { checkDealValues, moneyInputValue } from "@/lib/sales/board-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The deal value dialog (mockup `askValue`). "Move" mode opens before a move
// into a stage that needs a price (Proposal Sent): both values are required and
// "Save and move" sends them with the move. "Edit" mode changes the values from
// the deal panel; $0 is allowed there unless the deal sits in such a stage (the
// server refuses that too, spec rules 2 and 8). Every box at fault turns red,
// and only those (checkDealValues); a refusal from the server marks neither box.

/** The message under the boxes, and which of them it is about. */
type FormError = { message: string; invalid: { total: boolean; monthly: boolean } };

const NO_BOX = { total: false, monthly: false };

export type DealValues = { valueCents: number; mrrCents: number };

export function ValueDialog({
  open,
  onOpenChange,
  mode,
  dealTitle,
  stageName,
  requireBoth,
  initialValueCents,
  initialMrrCents,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "move" | "edit";
  dealTitle: string;
  stageName: string;
  /** Both values must be above $0 (a move into, or a deal sitting in, a stage that needs a price). */
  requireBoth: boolean;
  initialValueCents: number;
  initialMrrCents: number;
  /** Saves the values; answers null when done, or the message to show under the fields. */
  onSave: (values: DealValues) => Promise<string | null>;
}) {
  const firstFieldRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" initialFocus={firstFieldRef}>
        <ValueForm
          firstFieldRef={firstFieldRef}
          mode={mode}
          dealTitle={dealTitle}
          stageName={stageName}
          requireBoth={requireBoth}
          initialValueCents={initialValueCents}
          initialMrrCents={initialMrrCents}
          onCancel={() => onOpenChange(false)}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  );
}

// The form lives inside the dialog's popup, which unmounts when the dialog
// closes, so every opening starts from the stored values with no old error.
function ValueForm({
  firstFieldRef,
  mode,
  dealTitle,
  stageName,
  requireBoth,
  initialValueCents,
  initialMrrCents,
  onCancel,
  onSave,
}: {
  firstFieldRef: React.RefObject<HTMLInputElement | null>;
  mode: "move" | "edit";
  dealTitle: string;
  stageName: string;
  requireBoth: boolean;
  initialValueCents: number;
  initialMrrCents: number;
  onCancel: () => void;
  onSave: (values: DealValues) => Promise<string | null>;
}) {
  const id = useId();
  const [total, setTotal] = useState(() => moneyInputValue(initialValueCents));
  const [monthly, setMonthly] = useState(() => moneyInputValue(initialMrrCents));
  const monthlyRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<FormError | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = `${id}-error`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const check = checkDealValues(total, monthly, requireBoth);
    if (!check.ok) {
      setError({ message: check.message, invalid: check.invalid });
      // Straight to the first box that needs fixing.
      (check.invalid.total ? firstFieldRef : monthlyRef).current?.focus();
      return;
    }
    setError(null);
    setSaving(true);
    const problem = await onSave(check.values);
    // On success the dialog closes and this form unmounts; only a refusal stays to be read.
    if (problem) {
      setError({ message: problem, invalid: NO_BOX });
      setSaving(false);
    }
  }

  const totalInvalid = error?.invalid.total ?? false;
  const monthlyInvalid = error?.invalid.monthly ?? false;

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{mode === "move" ? "Add the deal value first" : "Deal value"}</DialogTitle>
        {mode === "move" ? (
          <DialogDescription>
            {dealTitle} is moving to <strong className="font-semibold text-foreground">{stageName}</strong>. A proposal needs
            a real price, so both values are required.
          </DialogDescription>
        ) : null}
      </DialogHeader>

      <div className="grid gap-1.5">
        <div className="grid gap-3 min-[400px]:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-total`} className="text-xs text-muted-foreground">
              Total value ($)
            </Label>
            <Input
              ref={firstFieldRef}
              id={`${id}-total`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="14400"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              aria-invalid={totalInvalid || undefined}
              aria-describedby={totalInvalid ? errorId : undefined}
              className="tabular-nums pointer-coarse:h-10"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-monthly`} className="text-xs text-muted-foreground">
              Monthly value ($)
            </Label>
            <Input
              ref={monthlyRef}
              id={`${id}-monthly`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="1200"
              value={monthly}
              onChange={(event) => setMonthly(event.target.value)}
              aria-invalid={monthlyInvalid || undefined}
              aria-describedby={monthlyInvalid ? errorId : undefined}
              className="tabular-nums pointer-coarse:h-10"
            />
          </div>
        </div>
        {error ? (
          <p id={errorId} role="alert" className="text-[0.8rem] text-destructive">
            {error.message}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} className="pointer-coarse:min-h-10">
          Cancel
        </Button>
        <Button type="submit" disabled={saving} className="pointer-coarse:min-h-10">
          {mode === "move" ? "Save and move" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
