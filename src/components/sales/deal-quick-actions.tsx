"use client";

import { useRef, useState } from "react";
import { ArrowRight, CalendarPlus, Check, RotateCcw, SquareArrowOutUpRight, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { deleteDealRequest } from "@/lib/sales/api-client";
import type { BoardCard, BoardStage } from "@/lib/sales/board";
import { canChangeDeal } from "@/lib/sales/board-client";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// A card's quick actions (spec 7.4 right-click, Decision 10): right-click,
// long-press on touch, or Shift+F10 / the Menu key on a focused card. Open,
// Add activity, Move to, Mark won, Mark lost, and Delete for admins. This also
// gives touch screens their way to move a deal (spec 7.10). The delete confirm
// keeps its open state here, beside the menu, so it outlives the menu closing.

export type DealsViewer = { userId: string; isAdmin: boolean };

/** What the board lets a card do. Moves and status changes go through useDealMoves (with the board's optimistic hooks). */
export type CardActions = {
  /** Opens the deal panel; `compose` opens it on the Activity composer. */
  open(dealId: string, compose?: boolean): void;
  move(card: BoardCard, target: BoardStage): void;
  setStatus(card: BoardCard, status: "WON" | "LOST" | "OPEN"): void;
  /** After a change the server made without useDealMoves (a delete): refresh the page. */
  changed(): void;
};

/**
 * Open state for a submenu that opens on hover and also on a press. Base UI's
 * SubmenuTrigger ignores a mouse press while it opens on hover (useClick with
 * ignoreMouse, @base-ui/react 1.6.0), so a click on "Move to" did nothing; on
 * touch a tap is the only way in. Hover and the arrow keys still open it
 * through Base UI (`onOpenChange`); a press on the trigger only ever opens it,
 * so it never closes on the same gesture that, or whose hover, just opened it.
 * It closes with the card menu too, so the next right-click starts closed.
 */
export function pressOpensSubmenu(setOpen: (open: boolean) => void) {
  return {
    onOpenChange: (open: boolean) => setOpen(open),
    onTriggerClick: () => setOpen(true),
    onMenuOpenChange: (open: boolean) => {
      if (!open) setOpen(false);
    },
  };
}

export function DealQuickActions({
  card,
  stages,
  viewer,
  actions,
  children,
}: {
  card: BoardCard;
  stages: BoardStage[];
  viewer: DealsViewer;
  actions: CardActions;
  /** The card element: it becomes the menu's trigger. */
  children: React.ReactElement;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const moveTo = pressOpensSubmenu(setMoveOpen);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const canChange = canChangeDeal(viewer, card);
  const isOpenDeal = card.status === "OPEN";

  async function confirmDelete() {
    setDeleting(true);
    const result = await deleteDealRequest(card.id);
    setDeleting(false);
    setConfirmOpen(false);
    if (result.ok) toast("Deal deleted.");
    else toast.error(result.error);
    actions.changed();
  }

  return (
    <>
      <ContextMenu onOpenChange={moveTo.onMenuOpenChange}>
        <ContextMenuTrigger render={children} />
        <ContextMenuContent aria-label={`Actions for ${card.title}`}>
          <ContextMenuItem onClick={() => actions.open(card.id)}>
            <SquareArrowOutUpRight aria-hidden="true" />
            Open
          </ContextMenuItem>
          {canChange ? (
            <>
              <ContextMenuItem onClick={() => actions.open(card.id, true)}>
                <CalendarPlus aria-hidden="true" />
                Add activity
              </ContextMenuItem>
              {isOpenDeal ? (
                <>
                  <ContextMenuSub open={moveOpen} onOpenChange={moveTo.onOpenChange}>
                    <ContextMenuSubTrigger onClick={moveTo.onTriggerClick}>
                      <ArrowRight aria-hidden="true" />
                      Move to
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      <ContextMenuRadioGroup
                        value={card.stageId}
                        onValueChange={(stageId: string) => {
                          const target = stages.find((stage) => stage.id === stageId);
                          if (target) actions.move(card, target);
                        }}
                      >
                        {stages.map((stage) => (
                          <ContextMenuRadioItem key={stage.id} value={stage.id} closeOnClick>
                            {stage.name}
                          </ContextMenuRadioItem>
                        ))}
                      </ContextMenuRadioGroup>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuItem onClick={() => actions.setStatus(card, "WON")}>
                    <Check aria-hidden="true" className="text-green-600 dark:text-green-500" />
                    Mark won
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => actions.setStatus(card, "LOST")}>
                    <X aria-hidden="true" className="text-red-600 dark:text-red-400" />
                    Mark lost
                  </ContextMenuItem>
                </>
              ) : (
                <ContextMenuItem onClick={() => actions.setStatus(card, "OPEN")}>
                  <RotateCcw aria-hidden="true" />
                  Reopen
                </ContextMenuItem>
              )}
            </>
          ) : null}
          {viewer.isAdmin ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
                <Trash2 aria-hidden="true" />
                Delete
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>

      {viewer.isAdmin ? (
        <Dialog open={confirmOpen} onOpenChange={(open) => !deleting && setConfirmOpen(open)}>
          <DialogContent role="alertdialog" showCloseButton={false} initialFocus={cancelRef} className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="leading-snug break-words">Delete {card.title}?</DialogTitle>
              <DialogDescription>It disappears from the board. Its history stays.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button ref={cancelRef} variant="outline" onClick={() => setConfirmOpen(false)} className="pointer-coarse:min-h-10">
                Cancel
              </Button>
              <Button variant="destructive" disabled={deleting} onClick={confirmDelete} className="pointer-coarse:min-h-10">
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
