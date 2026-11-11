"use client";

import { useState } from "react";
import { toast } from "sonner";

import { moveDealRequest, setDealStatusRequest, updateDealRequest } from "@/lib/sales/api-client";
import type { BoardStage } from "@/lib/sales/board";
import { moveToast, needsValueFirst, undoMoveBody } from "@/lib/sales/board-client";
import type { MoveResult } from "@/lib/sales/stage-moves";
import { LostDialog, type LostReason } from "@/components/sales/lost-dialog";
import { ValueDialog, type DealValues } from "@/components/sales/value-dialog";

// Moving a deal between stages and marking it won, lost or open again, shared
// by the board, its card menu and (Task 8) the deal panel's stage bar and
// buttons. Each change asks the server, toasts the result with Undo
// (Decision 24), then calls `onChanged` (a router refresh) so the screen shows
// what is stored. The value dialog opens before a move that needs a price; the
// lost dialog always asks for a reason. The caller renders `dialogs`.

export type MovableDeal = { id: string; title: string; stageId: string; valueCents: number; mrrCents: number };

/** Lets a screen show a change before the server answers (`optimistic`) and take it back if it is refused (`revert`). */
export type MoveHooks = { optimistic?: () => void; revert?: () => void };

type ValueRequest =
  | { mode: "move"; deal: MovableDeal; target: BoardStage; hooks?: MoveHooks }
  | { mode: "edit"; deal: MovableDeal; stage: BoardStage };

type LostRequest = { deal: MovableDeal; hooks?: MoveHooks };

export function useDealMoves(onChanged: () => void): {
  move(deal: MovableDeal, target: BoardStage, hooks?: MoveHooks): Promise<void>;
  setStatus(deal: MovableDeal, status: "WON" | "LOST" | "OPEN", hooks?: MoveHooks): Promise<void>;
  editValue(deal: MovableDeal, stage: BoardStage): void;
  dialogs: React.ReactNode;
} {
  // The request stays set while the dialog plays its closing animation, so its text does not blank out.
  const [valueRequest, setValueRequest] = useState<ValueRequest | null>(null);
  const [valueOpen, setValueOpen] = useState(false);
  const [lostRequest, setLostRequest] = useState<LostRequest | null>(null);
  const [lostOpen, setLostOpen] = useState(false);

  /** The toast after a move: Undo moves it back (taking back the No Show call), and a won or lost stage offers the status. */
  function announceMove(deal: MovableDeal, result: MoveResult) {
    if (!result.changed) return;
    const moved: MovableDeal = {
      ...deal,
      stageId: result.deal.stageId,
      valueCents: result.deal.valueCents,
      mrrCents: result.deal.mrrCents,
    };
    const { message, offer } = moveToast(result.enteredStage, result.createdActivityIds.length > 0);
    toast(message, {
      action: offer
        ? {
            label: offer === "won" ? "Mark won" : "Mark lost",
            onClick: () => void setStatus(moved, offer === "won" ? "WON" : "LOST"),
          }
        : undefined,
      cancel: { label: "Undo", onClick: () => void undoMove(moved, result) },
    });
  }

  /** Moves the deal back; the server puts back its days in stage and takes back the No Show call (undoMoveBody). */
  async function undoMove(deal: MovableDeal, move: MoveResult) {
    const result = await moveDealRequest(deal.id, undoMoveBody(move));
    if (!result.ok) toast.error(result.error);
    onChanged();
  }

  async function move(deal: MovableDeal, target: BoardStage, hooks?: MoveHooks) {
    if (target.id === deal.stageId) return;
    if (needsValueFirst(deal, target)) {
      setValueRequest({ mode: "move", deal, target, hooks });
      setValueOpen(true);
      return;
    }
    hooks?.optimistic?.();
    const result = await moveDealRequest(deal.id, { stageId: target.id });
    if (!result.ok) {
      hooks?.revert?.();
      if (result.code === "PROPOSAL_NEEDS_VALUE") {
        // The board showed an old value (another tab, or it was just cleared): ask for it now (Review Focus 1).
        setValueRequest({ mode: "move", deal, target, hooks });
        setValueOpen(true);
      } else {
        toast.error(result.error);
      }
      return;
    }
    announceMove(deal, result.data);
    onChanged();
  }

  async function reopen(deal: MovableDeal) {
    const result = await setDealStatusRequest(deal.id, { status: "OPEN" });
    if (!result.ok) toast.error(result.error);
    onChanged();
  }

  async function setStatus(deal: MovableDeal, status: "WON" | "LOST" | "OPEN", hooks?: MoveHooks) {
    if (status === "LOST") {
      setLostRequest({ deal, hooks });
      setLostOpen(true);
      return;
    }
    if (status === "WON") hooks?.optimistic?.();
    const result = await setDealStatusRequest(deal.id, { status });
    if (!result.ok) {
      hooks?.revert?.();
      toast.error(result.error);
      return;
    }
    if (result.data.changed) {
      if (status === "WON") {
        toast(`${deal.title} won. Nice work.`, { cancel: { label: "Undo", onClick: () => void reopen(deal) } });
      } else {
        toast("Reopened.");
      }
    }
    onChanged();
  }

  function editValue(deal: MovableDeal, stage: BoardStage) {
    setValueRequest({ mode: "edit", deal, stage });
    setValueOpen(true);
  }

  async function saveValues(request: ValueRequest, values: DealValues): Promise<string | null> {
    if (request.mode === "edit") {
      const result = await updateDealRequest(request.deal.id, values);
      if (!result.ok) return result.error;
      setValueOpen(false);
      toast("Value saved.");
      onChanged();
      return null;
    }
    const result = await moveDealRequest(request.deal.id, { stageId: request.target.id, ...values });
    if (!result.ok) return result.error;
    setValueOpen(false);
    request.hooks?.optimistic?.();
    announceMove(request.deal, result.data);
    onChanged();
    return null;
  }

  async function saveLost(request: LostRequest, input: { lostReason: LostReason; lostComment: string }): Promise<string | null> {
    const result = await setDealStatusRequest(request.deal.id, {
      status: "LOST",
      lostReason: input.lostReason,
      ...(input.lostComment ? { lostComment: input.lostComment } : {}),
    });
    if (!result.ok) return result.error;
    setLostOpen(false);
    request.hooks?.optimistic?.();
    if (result.data.changed) {
      toast(`${request.deal.title} marked lost.`, {
        cancel: { label: "Undo", onClick: () => void reopen(request.deal) },
      });
    }
    onChanged();
    return null;
  }

  const dialogs = (
    <>
      {valueRequest ? (
        <ValueDialog
          open={valueOpen}
          onOpenChange={setValueOpen}
          mode={valueRequest.mode}
          dealTitle={valueRequest.deal.title}
          stageName={valueRequest.mode === "move" ? valueRequest.target.name : valueRequest.stage.name}
          requireBoth={valueRequest.mode === "move" ? valueRequest.target.requiresValue : valueRequest.stage.requiresValue}
          initialValueCents={valueRequest.deal.valueCents}
          initialMrrCents={valueRequest.deal.mrrCents}
          onSave={(values) => saveValues(valueRequest, values)}
        />
      ) : null}
      {lostRequest ? (
        <LostDialog
          open={lostOpen}
          onOpenChange={setLostOpen}
          dealTitle={lostRequest.deal.title}
          onSave={(input) => saveLost(lostRequest, input)}
        />
      ) : null}
    </>
  );

  return { move, setStatus, editValue, dialogs };
}
