"use client";

import { useId, useRef, useState } from "react";

import { LOST_COMMENT_MAX, LOST_REASONS } from "@/lib/sales/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// "Mark as lost" (mockup `askLost`). Lost always asks for a reason (guide); the
// comment is optional. No reason is picked for the person, so the reports keep
// a real one rather than whatever the list happened to start on.

export type LostReason = (typeof LOST_REASONS)[number];

const PICK_REASON = "Pick a reason.";
const REASON_ITEMS = Object.fromEntries(LOST_REASONS.map((reason) => [reason, reason]));

export function LostDialog({
  open,
  onOpenChange,
  dealTitle,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealTitle: string;
  /** Marks the deal lost; answers null when done, or the message to show in the dialog. */
  onSave: (input: { lostReason: LostReason; lostComment: string }) => Promise<string | null>;
}) {
  const reasonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" initialFocus={reasonRef}>
        <LostForm reasonRef={reasonRef} dealTitle={dealTitle} onCancel={() => onOpenChange(false)} onSave={onSave} />
      </DialogContent>
    </Dialog>
  );
}

function LostForm({
  reasonRef,
  dealTitle,
  onCancel,
  onSave,
}: {
  reasonRef: React.RefObject<HTMLButtonElement | null>;
  dealTitle: string;
  onCancel: () => void;
  onSave: (input: { lostReason: LostReason; lostComment: string }) => Promise<string | null>;
}) {
  const id = useId();
  const [reason, setReason] = useState<LostReason | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = `${id}-error`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!reason) {
      setError(PICK_REASON);
      reasonRef.current?.focus();
      return;
    }
    setError(null);
    setSaving(true);
    const problem = await onSave({ lostReason: reason, lostComment: comment.trim() });
    if (problem) {
      setError(problem);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Mark as lost</DialogTitle>
        <DialogDescription className="sr-only">Why {dealTitle} was lost.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label id={`${id}-reason-label`} className="text-xs text-muted-foreground">
          Reason
        </Label>
        <Select
          items={REASON_ITEMS}
          value={reason}
          onValueChange={(value) => {
            setReason(value as LostReason | null);
            setError(null);
          }}
        >
          <SelectTrigger
            ref={reasonRef}
            aria-labelledby={`${id}-reason-label`}
            aria-invalid={error === PICK_REASON || undefined}
            aria-describedby={error ? errorId : undefined}
            className="w-full pointer-coarse:h-10"
          >
            <SelectValue placeholder="Pick a reason" />
          </SelectTrigger>
          <SelectContent>
            {LOST_REASONS.map((option) => (
              <SelectItem key={option} value={option} className="pointer-coarse:min-h-10">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-comment`} className="text-xs text-muted-foreground">
          Comment (optional)
        </Label>
        <Textarea
          id={`${id}-comment`}
          placeholder="What happened?"
          maxLength={LOST_COMMENT_MAX}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          className="min-h-20"
        />
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
        <Button
          type="submit"
          disabled={saving}
          className="bg-red-600 text-white hover:bg-red-600/90 focus-visible:ring-red-600/40 pointer-coarse:min-h-10"
        >
          Mark lost
        </Button>
      </DialogFooter>
    </form>
  );
}
