"use client";

import { ExternalLink, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nitroFlowUrl } from "@/lib/marketing/sequences";
import { safeExternalHref } from "@/lib/marketing/sync";
import type { Sequence, SequenceStep } from "@/lib/marketing/sequences";

type EmailStepOf = Extract<SequenceStep, { kind: "email" }>;

export function EmailModal({
  open,
  onClose,
  sequence,
  step,
  stepIndex,
}: {
  open: boolean;
  onClose: () => void;
  sequence: Sequence;
  step: EmailStepOf;
  /** Index of the step within sequence.steps (for the edit contract). */
  stepIndex?: number;
}) {
  // Defense in depth: nitroFlowUrl is already derived from a fixed base, but
  // safeExternalHref guarantees https + allow-listed host before we render it.
  const nitroUrl = safeExternalHref(nitroFlowUrl(sequence));
  const index = stepIndex ?? sequence.steps.indexOf(step);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="gap-5 p-5 sm:max-w-xl"
      >
        <DialogClose
          aria-label="Close"
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 pointer-coarse:size-11"
            />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>

        <DialogHeader className="gap-2 pr-10">
          <span
            data-day
            className="w-fit rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary"
          >
            {step.day}
          </span>
          <DialogTitle className="text-lg leading-snug font-semibold">
            {step.subject}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Full copy of this email in the {sequence.displayName} sequence.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              From
            </dt>
            <dd className="text-sm break-words">{sequence.fromAddress}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              Goal
            </dt>
            <dd className="text-sm">{step.goal}</dd>
          </div>
        </dl>

        <pre className="rounded-lg border bg-muted/40 p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">
          {step.body}
        </pre>

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {nitroUrl
              ? `Opens Flow ${sequence.flowId} in NitroSend`
              : "Not built in NitroSend yet"}
          </p>
          {nitroUrl ? (
            <Button
              variant="outline"
              size="sm"
              className="pointer-coarse:min-h-10"
              render={
                <a
                  href={nitroUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label="Edit this email in NitroSend — opens in a new tab"
                  data-edit-target="email"
                  data-sequence={sequence.key}
                  data-step-index={index}
                  data-subject={step.subject}
                  data-nitro-url={nitroUrl}
                />
              }
            >
              Edit in NitroSend
              <ExternalLink />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="pointer-coarse:min-h-10"
            >
              Edit in NitroSend
              <ExternalLink />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
