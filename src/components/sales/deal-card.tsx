"use client";

import { useDraggable } from "@dnd-kit/core";

import type { BoardCard, BoardStage } from "@/lib/sales/board";
import { canChangeDeal } from "@/lib/sales/board-client";
import { ACTIVITY_TYPE_LABELS } from "@/lib/sales/constants";
import { daysInStage, formatMoney, isRotting, nextStepPill } from "@/lib/sales/format";
import { cn } from "@/lib/utils";
import { DealQuickActions, type CardActions, type DealsViewer } from "@/components/sales/deal-quick-actions";
import { DaysPill, NextStepPill, OwnerAvatar } from "@/components/sales/sales-pills";

// One deal on the board (mockup `.dcard`): name and value, person and monthly
// value, then the next step, days in stage and the owner. Click or Enter opens
// the deal panel. The owner or an admin can drag an open deal with the mouse,
// or with the keyboard (Space, arrows, Space); everyone gets the quick-actions
// menu (right-click, long-press, Shift+F10). Touch never drags, so swiping the
// board sideways never picks a card up (Decision 11).

/** What the card shows; also drawn under the pointer while dragging. */
export function DealCardFace({
  card,
  rotting,
  days,
  now,
  ownerName,
}: {
  card: BoardCard;
  rotting: boolean;
  days: number;
  now: Date;
  ownerName: string;
}) {
  const subtitle = card.personName ?? card.organizationName;
  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{card.title}</span>
        <span className="shrink-0 text-[12.5px] font-semibold tabular-nums">{formatMoney(card.valueCents)}</span>
      </div>
      {subtitle || card.mrrCents > 0 ? (
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {subtitle ? <span className="truncate">{subtitle}</span> : null}
          {card.mrrCents > 0 ? (
            <span className="shrink-0 tabular-nums">
              {subtitle ? "· " : ""}
              {formatMoney(card.mrrCents)}/mo
            </span>
          ) : null}
        </div>
      ) : null}
      {/* Wraps when a timed next step and an idle-days pill do not fit a narrow column: the avatar drops a line instead of spilling out. */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <NextStepPill next={card.next} now={now} />
        <DaysPill days={days} rotting={rotting} />
        <OwnerAvatar id={card.ownerId} name={ownerName} className="ml-auto" />
      </div>
    </>
  );
}

export const CARD_CLASS =
  "flex cursor-pointer flex-col gap-[3px] rounded-lg border bg-card px-2.5 py-[9px] text-left shadow-sm outline-none select-none [-webkit-tap-highlight-color:transparent]";

/** Opens the quick-actions menu from the keyboard (Shift+F10 or the Menu key), anchored to the card's lower left. */
function openMenuFromKeyboard(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 12,
      clientY: rect.bottom - 4,
    }),
  );
}

export function DealCard({
  card,
  stage,
  stages,
  now,
  ownerName,
  viewer,
  actions,
}: {
  card: BoardCard;
  stage: BoardStage;
  stages: BoardStage[];
  now: Date;
  ownerName: string;
  viewer: DealsViewer;
  actions: CardActions;
}) {
  const canMove = card.status === "OPEN" && canChangeDeal(viewer, card);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { kind: "card" },
    disabled: !canMove,
    attributes: { roleDescription: "deal" },
  });

  const days = daysInStage(new Date(card.stageEnteredAt), now);
  const rotting = card.status === "OPEN" && isRotting(days, stage.rottingDays);
  const next = card.next
    ? `${ACTIVITY_TYPE_LABELS[card.next.type]} ${nextStepPill(new Date(card.next.dueAt), now, card.next.hasTime).label}`
    : "No next step";
  const label = [
    card.title,
    formatMoney(card.valueCents),
    next,
    `${days} ${days === 1 ? "day" : "days"} in this stage${rotting ? ", idle too long" : ""}`,
    `Owner ${ownerName}`,
  ].join(", ");

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    // A card that cannot move is a plain button: Space opens it too.
    if (event.key === "Enter" || (!canMove && event.key === " ")) {
      if (isDragging) return;
      event.preventDefault();
      actions.open(card.id);
      return;
    }
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      openMenuFromKeyboard(event.currentTarget);
      return;
    }
    listeners?.onKeyDown?.(event);
  }

  return (
    <DealQuickActions card={card} stages={stages} viewer={viewer} actions={actions}>
      <div
        ref={setNodeRef}
        {...(canMove ? { ...attributes, ...listeners } : { role: "button", tabIndex: 0 })}
        // The deal panel finds the card by this to put focus back on it when it closes.
        data-deal-id={card.id}
        aria-label={label}
        onKeyDown={handleKeyDown}
        onClick={() => actions.open(card.id)}
        className={cn(
          CARD_CLASS,
          "transition-[border-color,opacity] duration-150 hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          isDragging && "opacity-40",
        )}
      >
        <DealCardFace card={card} rotting={rotting} days={days} now={now} ownerName={ownerName} />
      </div>
    </DealQuickActions>
  );
}
