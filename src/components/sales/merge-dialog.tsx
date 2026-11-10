"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { getMergePreview, mergeContactsRequest, type ApiResult } from "@/lib/sales/api-client";
import type { MergeCounts } from "@/lib/sales/contact-merge";
import {
  MERGE_PREVIEW_ERROR,
  mergeConfirmLine,
  mergeCountsLine,
  mergeFillLine,
  mergedToast,
} from "@/lib/sales/contacts-client";
import type { ContactKind } from "@/lib/sales/contacts-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The merge-two-contacts dialog (Mockup v2 `mergeModal`, Decision 20). Admins
// only: the panel wires this open once a visible duplicate was picked. On
// open it loads the preview (names and row counts); swapping the "keep" radio
// swaps which id is kept and reloads the preview, which is a fresh GET with
// the new keep/drop. On merge it POSTs and the panel URL moves to the kept id.
// No Undo.

type Preview = { keep: { id: string; name: string }; drop: { id: string; name: string }; counts: MergeCounts };

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: Preview };

export function MergeDialog({
  open,
  onOpenChange,
  kind,
  keepId,
  dropId,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ContactKind;
  keepId: string;
  dropId: string;
  /** After a successful merge: the panel URL swaps to the kept contact and refreshes. */
  onMerged: (kept: { id: string; name: string }) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" initialFocus={closeRef}>
        {open ? (
          <MergeDialogBody
            key={`${kind}:${keepId}:${dropId}`}
            kind={kind}
            keepId={keepId}
            dropId={dropId}
            closeRef={closeRef}
            onCancel={() => onOpenChange(false)}
            onMerged={(kept) => {
              onOpenChange(false);
              onMerged(kept);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog's body, keyed by the pair so a new pair restarts state. Loads the
 * preview on mount and again whenever the "keep" radio swaps; a merge POSTs
 * with the current pair and hands the kept contact back.
 */
function MergeDialogBody({
  kind,
  keepId,
  dropId,
  closeRef,
  onCancel,
  onMerged,
}: {
  kind: ContactKind;
  keepId: string;
  dropId: string;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onMerged: (kept: { id: string; name: string }) => void;
}) {
  // Which id is being kept right now; swapping the radio flips the two.
  const [keep, setKeep] = useState(keepId);
  const drop = keep === keepId ? dropId : keepId;

  // The last request's answer, if any. A mismatch between the current pair
  // (plus Try-again tick) and the `pair` saved here means a request is in
  // flight: that renders as the loading placeholder, without setState in the
  // effect that fires the request.
  type Loaded = { pair: string; result: ApiResult<Preview> } | null;
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [saving, setSaving] = useState(false);
  // Each load takes a ticket; only the newest one's answer is shown.
  const latest = useRef(0);
  // Bumped by Try again so the load effect runs again without changing the pair.
  const [loadTick, setLoadTick] = useState(0);
  const pairKey = `${keep}:${drop}:${loadTick}`;

  const onLoaded = useEffectEvent((ticket: number, requested: string, result: ApiResult<Preview>) => {
    if (ticket !== latest.current) return;
    setLoaded({ pair: requested, result });
  });

  // Load (or reload) the preview whenever the pair changes or Try again is clicked.
  useEffect(() => {
    const ticket = ++latest.current;
    const requested = pairKey;
    void getMergePreview(kind, keep, drop).then((result) => onLoaded(ticket, requested, result));
  }, [kind, keep, drop, loadTick, pairKey]);

  function swap(nextKeep: string) {
    if (nextKeep === keep) return;
    setKeep(nextKeep);
  }

  async function doMerge() {
    const preview = loaded?.pair === pairKey && loaded.result.ok ? loaded.result.data : null;
    if (!preview || saving) return;
    setSaving(true);
    const result = await mergeContactsRequest(kind, keep, drop);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const dropName = preview.drop.name;
    toast(mergedToast(result.data.kept.name, dropName));
    onMerged(result.data.kept);
  }

  const title = kind === "person" ? "Merge two people" : "Merge two organizations";

  // Which state to show: loading until the latest ticket's answer is here for
  // the current pair; else that answer (ok or an error).
  const state: PreviewState =
    loaded && loaded.pair === pairKey
      ? loaded.result.ok
        ? { status: "ready", preview: loaded.result.data }
        : { status: "error", message: loaded.result.error }
      : { status: "loading" };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Pick the one to keep.</DialogDescription>
      </DialogHeader>

      {state.status === "ready" ? (
        <ReadyBody
          kind={kind}
          keep={state.preview.keep}
          drop={state.preview.drop}
          counts={state.preview.counts}
          keepId={keep}
          onSwap={swap}
        />
      ) : state.status === "loading" ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Loading what will move...
        </p>
      ) : (
        <div role="alert" className="flex flex-col gap-2 text-sm">
          <p className="m-0 text-destructive">{MERGE_PREVIEW_ERROR}</p>
          <p className="m-0 text-xs text-muted-foreground">{state.message}</p>
          <div>
            <Button variant="outline" size="sm" onClick={() => setLoadTick((tick) => tick + 1)} className="pointer-coarse:min-h-10">
              Try again
            </Button>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button ref={closeRef} variant="outline" onClick={onCancel} className="pointer-coarse:min-h-10">
          Cancel
        </Button>
        <Button
          onClick={() => void doMerge()}
          disabled={state.status !== "ready" || saving}
          aria-busy={saving || undefined}
          className="pointer-coarse:min-h-10"
        >
          {state.status === "ready" ? `Merge into ${state.preview.keep.name}` : title}
        </Button>
      </DialogFooter>
    </>
  );
}

function ReadyBody({
  kind,
  keep,
  drop,
  counts,
  keepId,
  onSwap,
}: {
  kind: ContactKind;
  keep: { id: string; name: string };
  drop: { id: string; name: string };
  counts: MergeCounts;
  keepId: string;
  onSwap: (nextKeep: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div role="radiogroup" aria-label="Which one to keep" className="grid gap-2">
        <KeepOption name={keep.name} id={keep.id} checked={keepId === keep.id} onPick={onSwap} />
        <KeepOption name={drop.name} id={drop.id} checked={keepId === drop.id} onPick={onSwap} />
      </div>
      <p className="m-0">{mergeConfirmLine(kind, keep.name, drop.name)}</p>
      <p className="m-0 text-xs text-muted-foreground">{mergeFillLine(keep.name, drop.name)}</p>
      <div
        role="status"
        className={cn(
          "flex items-start gap-2 rounded-[9px] px-3 py-[9px] text-[13px]",
          "bg-status-warning text-status-warning-foreground",
        )}
      >
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">
          <strong className="font-semibold">{mergeCountsLine(counts)}</strong> This cannot be undone.
        </span>
      </div>
    </div>
  );
}

function KeepOption({
  name,
  id,
  checked,
  onPick,
}: {
  name: string;
  id: string;
  checked: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-[9px] border bg-card px-3 py-2 text-sm pointer-coarse:min-h-10">
      <input
        type="radio"
        name="merge-keep"
        value={id}
        checked={checked}
        onChange={() => onPick(id)}
        className="size-4 accent-primary"
      />
      <span className="min-w-0 font-semibold">{name}</span>
    </label>
  );
}
