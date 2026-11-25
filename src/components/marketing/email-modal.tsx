"use client";

import { useMemo, useState, useTransition } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { saveEmailDraftAction } from "@/app/(app)/marketing/follow-up-system/actions";
import { EmailDiffView } from "@/components/marketing/email-diff-view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { diffEmail, extractVariables } from "@/lib/marketing/email-diff";
import type {
  EmailDraft,
  SaveDraftErrorKind,
} from "@/lib/marketing/email-editor-types";
import { nitroFlowUrl } from "@/lib/marketing/sequences";
import { safeExternalHref } from "@/lib/marketing/sync";
import type { Sequence, SequenceStep } from "@/lib/marketing/sequences";

type EmailStepOf = Extract<SequenceStep, { kind: "email" }>;
type Mode = "read" | "edit" | "diff" | "done";

// Never show raw server text; map each kind to a human sentence.
const ERROR_COPY: Record<SaveDraftErrorKind, string> = {
  missing_key: "NitroSend isn't connected yet. Ask an admin to add the API key.",
  unauthorized: "NitroSend rejected our key. Ask an admin to check it.",
  forbidden: "You don't have permission to edit this email.",
  api_unreachable: "Couldn't reach NitroSend. Check your connection and try again.",
  rate_limited: "NitroSend is busy. Wait a moment and try again.",
  flow_not_found: "That flow wasn't found in NitroSend.",
  unknown: "Something went wrong saving. Nothing was changed. Try again.",
};

export function EmailModal({
  open,
  onClose,
  sequence,
  step,
  stepIndex,
  canEditInline,
}: {
  open: boolean;
  onClose: () => void;
  sequence: Sequence;
  step: EmailStepOf;
  /** Index of the step within sequence.steps (for the edit contract). */
  stepIndex?: number;
  /** False hides "Edit here"; the NitroSend fallback always stays. */
  canEditInline: boolean;
}) {
  // Defense in depth: nitroFlowUrl is already derived from a fixed base, but
  // safeExternalHref guarantees https + allow-listed host before we render it.
  const nitroUrl = safeExternalHref(nitroFlowUrl(sequence));
  const index = stepIndex ?? sequence.steps.indexOf(step);

  const original = useMemo<EmailDraft>(
    () => ({ subject: step.subject, body: step.body }),
    [step.subject, step.body],
  );
  const [mode, setMode] = useState<Mode>("read");
  const [draft, setDraft] = useState<EmailDraft>(original);
  const [confirmedDrop, setConfirmedDrop] = useState(false);
  const [serverWantsConfirm, setServerWantsConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const diff = useMemo(
    () => (mode === "diff" ? diffEmail(original, draft) : null),
    [mode, original, draft],
  );
  const variables = useMemo(
    () => (mode === "edit" ? extractVariables(draft.body) : []),
    [mode, draft.body],
  );

  const dropped = diff?.droppedVariables ?? [];
  const needsConfirm = dropped.length > 0 || serverWantsConfirm;

  function reset() {
    setMode("read");
    setDraft(original);
    setConfirmedDrop(false);
    setServerWantsConfirm(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function save() {
    startTransition(async () => {
      try {
        const res = await saveEmailDraftAction({
          flowId: sequence.flowId,
          stepIndex: index,
          before: original,
          after: draft,
          confirmedDrop,
        });
        if (res.ok) {
          setMode("done");
        } else if (res.needsConfirmation) {
          setServerWantsConfirm(true);
          setConfirmedDrop(false);
        } else {
          toast.error(ERROR_COPY[res.error?.kind ?? "unknown"] ?? ERROR_COPY.unknown);
        }
      } catch {
        toast.error(ERROR_COPY.unknown);
      }
    });
  }

  const nitroLink = nitroUrl ? (
    <Button
      variant="outline"
      size="sm"
      className="pointer-coarse:min-h-10"
      render={
        <a
          href={nitroUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={
            mode === "done"
              ? "Open flow in NitroSend, opens in a new tab"
              : "Edit this email in NitroSend, opens in a new tab"
          }
          data-edit-target="email"
          data-sequence={sequence.key}
          data-step-index={index}
          data-subject={step.subject}
          data-nitro-url={nitroUrl}
        />
      }
    >
      {mode === "done" ? "Open flow in NitroSend" : "Edit in NitroSend"}
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
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[92dvh] gap-5 overflow-y-auto p-5 sm:max-w-xl"
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
            {mode === "edit"
              ? "Editing this email"
              : mode === "diff"
                ? "Review changes"
                : mode === "done"
                  ? "Saved to NitroSend"
                  : step.subject}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Full copy of this email in the {sequence.displayName} sequence.
          </DialogDescription>
        </DialogHeader>

        {mode === "read" && (
          <>
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
          </>
        )}

        {mode === "edit" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-edit-subject">Subject</Label>
              <Input
                id="email-edit-subject"
                value={draft.subject}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, subject: e.target.value }))
                }
                className="pointer-coarse:h-10"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-edit-body">Body</Label>
              <Textarea
                id="email-edit-body"
                value={draft.body}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, body: e.target.value }))
                }
                className="min-h-[220px] font-sans leading-relaxed whitespace-pre-wrap"
              />
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>Variables preserved:</span>
                {variables.length === 0 ? (
                  <span>none</span>
                ) : (
                  variables.map((v) => (
                    <code
                      key={v}
                      className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-primary"
                    >
                      {v}
                    </code>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {mode === "diff" && diff && (
          <div className="flex flex-col gap-4">
            <div
              role="note"
              className="flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-sm text-primary"
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                Safe Mode on. Saves to NitroSend as a Draft. The flow stays
                paused, no emails go out.
              </p>
            </div>

            <EmailDiffView diff={diff} />

            {needsConfirm && (
              <div
                role="alert"
                className="flex flex-col gap-3 rounded-lg bg-status-warning p-3 text-sm text-status-warning-foreground"
              >
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <p>
                    Heads up: these merge tags will be removed
                    {dropped.length > 0 && (
                      <>
                        {" "}
                        {dropped.map((v) => (
                          <code
                            key={v}
                            className="mx-0.5 rounded-md bg-background/60 px-1.5 py-0.5 font-mono"
                          >
                            {v}
                          </code>
                        ))}
                      </>
                    )}
                    . Each person will see a blank where their name was.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="email-confirm-drop"
                    checked={confirmedDrop}
                    onCheckedChange={(v) => setConfirmedDrop(v === true)}
                    aria-label="I know, save anyway"
                  />
                  <Label
                    htmlFor="email-confirm-drop"
                    className="min-h-6 cursor-pointer"
                  >
                    I know, save anyway.
                  </Label>
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "done" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-status-success text-status-success-foreground">
              <CheckCircle2 className="size-6" aria-hidden />
            </span>
            <p className="max-w-sm text-sm text-muted-foreground">
              Flow {sequence.flowId}, {step.day}. Status still Draft, nothing is
              sending until you flip it live in NitroSend yourself.
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden />
              Draft · saved just now
            </span>
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          {mode === "read" && (
            <>
              <p className="text-xs text-muted-foreground">
                {nitroUrl
                  ? `Opens Flow ${sequence.flowId} in NitroSend`
                  : "Not built in NitroSend yet"}
              </p>
              <div className="flex flex-wrap gap-2">
                {nitroLink}
                {canEditInline && (
                  <Button
                    size="sm"
                    className="pointer-coarse:min-h-10"
                    aria-label="Edit here"
                    onClick={() => setMode("edit")}
                  >
                    Edit here
                  </Button>
                )}
              </div>
            </>
          )}

          {mode === "edit" && (
            <>
              <div>{nitroLink}</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="pointer-coarse:min-h-10"
                  aria-label="Cancel"
                  onClick={reset}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="pointer-coarse:min-h-10"
                  aria-label="Review changes"
                  onClick={() => setMode("diff")}
                >
                  Review changes
                </Button>
              </div>
            </>
          )}

          {mode === "diff" && (
            <>
              <div>{nitroLink}</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="pointer-coarse:min-h-10"
                  aria-label="Back to edit"
                  disabled={pending}
                  onClick={() => setMode("edit")}
                >
                  Back to edit
                </Button>
                <Button
                  size="sm"
                  className="pointer-coarse:min-h-10"
                  aria-label="Save to NitroSend"
                  disabled={
                    pending || !diff?.changed || (needsConfirm && !confirmedDrop)
                  }
                  onClick={save}
                >
                  {pending && <Loader2 className="animate-spin" aria-hidden />}
                  Save to NitroSend
                </Button>
              </div>
            </>
          )}

          {mode === "done" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="pointer-coarse:min-h-10"
                aria-label="Back to start"
                onClick={reset}
              >
                Back to start
              </Button>
              {nitroLink}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
