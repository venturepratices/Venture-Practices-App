"use client";

import { useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { Check, Plus, X } from "lucide-react";

import type { BoardCard, BoardColumn, BoardStage } from "@/lib/sales/board";
import {
  applyOptimisticMove,
  applyOptimisticRemove,
  dealsSummary,
  DRAG_INSTRUCTIONS,
  dragAnnouncements,
  needsValueFirst,
  nextColumnIndex,
} from "@/lib/sales/board-client";
import { daysInStage, isRotting } from "@/lib/sales/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CARD_CLASS, DealCard, DealCardFace } from "@/components/sales/deal-card";
import type { CardActions, DealsViewer } from "@/components/sales/deal-quick-actions";
import type { MoveHooks } from "@/components/sales/use-deal-moves";

// The Deals board (mockup `viewDeals`, `.col`, `.dropbar`): one column per
// stage, newest in stage first. The board scrolls sideways inside itself, never
// the page; on phones each column is most of the screen wide and snaps into
// place. A mouse drag starts after 8px and shows the Won / Lost drop bar; a
// keyboard drag jumps one column per arrow key. A move shows at once and is
// taken back if the server refuses it.

const STATUS_ZONES = { "zone-won": "WON", "zone-lost": "LOST" } as const;
type ZoneId = keyof typeof STATUS_ZONES;

type BoardMoves = {
  move(deal: BoardCard, target: BoardStage, hooks?: MoveHooks): Promise<void>;
  setStatus(deal: BoardCard, status: "WON" | "LOST" | "OPEN", hooks?: MoveHooks): Promise<void>;
};

const isZone = (id: UniqueIdentifier): id is ZoneId => id in STATUS_ZONES;

export function DealsBoard({
  columns: serverColumns,
  now,
  viewer,
  ownerNames,
  moves,
  onOpen,
  onChanged,
  onOpenList,
  emptyState,
  onNewDeal,
}: {
  columns: BoardColumn[];
  now: Date;
  viewer: DealsViewer;
  ownerNames: Map<string, string>;
  moves: BoardMoves;
  onOpen: (dealId: string, compose?: boolean) => void;
  onChanged: () => void;
  onOpenList: () => void;
  /** Shown in the first column when the whole pipeline has no deals yet. */
  emptyState: React.ReactNode | null;
  /** Opens Add deal from an empty column; null keeps empty columns to the mockup line (filters on). */
  onNewDeal: (() => void) | null;
}) {
  // Local copy for optimistic moves. A new board from the server (a filter
  // change or a refresh after a move) replaces it, adjusted during render
  // rather than in an effect, so stale cards never flash.
  const [columns, setColumns] = useState(serverColumns);
  const [shownServerColumns, setShownServerColumns] = useState(serverColumns);
  if (serverColumns !== shownServerColumns) {
    setShownServerColumns(serverColumns);
    setColumns(serverColumns);
  }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pointerDrag, setPointerDrag] = useState(false);

  const stages = columns.map((column) => column.stage);
  const cardById = (id: UniqueIdentifier) => {
    for (const column of columns) {
      const card = column.cards.find((c) => c.id === id);
      if (card) return card;
    }
    return null;
  };
  const stageById = (id: UniqueIdentifier) => stages.find((stage) => stage.id === id) ?? null;
  const ownerName = (ownerId: string) => ownerNames.get(ownerId) ?? "No longer in Sales";

  function moveHooks(dealId: string, toStageId: string): MoveHooks {
    return {
      optimistic: () => setColumns((current) => applyOptimisticMove(current, dealId, toStageId, new Date().toISOString())),
      revert: () => setColumns(serverColumns),
    };
  }

  function removeHooks(dealId: string): MoveHooks {
    return {
      optimistic: () => setColumns((current) => applyOptimisticRemove(current, dealId)),
      revert: () => setColumns(serverColumns),
    };
  }

  const actions: CardActions = {
    open: onOpen,
    move: (card, target) => void moves.move(card, target, moveHooks(card.id, target.id)),
    setStatus: (card, status) => void moves.setStatus(card, status, status === "OPEN" ? undefined : removeHooks(card.id)),
    changed: onChanged,
  };

  // Keyboard drag: Left / Right jump to the next column's centre (the sensor scrolls the board when it has to).
  const coordinateGetter: KeyboardCoordinateGetter = (event, { active, context }) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return undefined;
    event.preventDefault();
    const { over, collisionRect, droppableRects } = context;
    if (!collisionRect) return undefined;
    const ids = stages.map((stage) => stage.id);
    const fromId = over && !isZone(over.id) ? String(over.id) : cardById(active)?.stageId;
    const current = fromId ? ids.indexOf(fromId) : -1;
    if (current === -1) return undefined;
    const target = ids[nextColumnIndex(current, event.key, ids.length)];
    const rect = droppableRects.get(target);
    if (!rect) return undefined;
    return { x: rect.left + rect.width / 2 - collisionRect.width / 2, y: collisionRect.top };
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
      coordinateGetter,
    }),
  );

  // A mouse drag prefers the Won / Lost zone under the pointer, then the column
  // under it, then the column the card overlaps most. A keyboard drag only ever
  // lands on columns (the drop bar is for the mouse).
  const collisionDetection: CollisionDetection = (args) => {
    const columnsOnly = args.droppableContainers.filter((container) => !isZone(container.id));
    if (args.pointerCoordinates) {
      const zones = pointerWithin({
        ...args,
        droppableContainers: args.droppableContainers.filter((container) => isZone(container.id)),
      });
      if (zones.length > 0) return zones;
      const under = pointerWithin({ ...args, droppableContainers: columnsOnly });
      if (under.length > 0) return under;
      return rectIntersection({ ...args, droppableContainers: columnsOnly });
    }
    return closestCenter({ ...args, droppableContainers: columnsOnly });
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const card = cardById(active.id);
      return card ? dragAnnouncements.onDragStart(card.title) : undefined;
    },
    onDragOver: ({ active, over }) => {
      const card = cardById(active.id);
      if (!card || !over) return undefined;
      const name = isZone(over.id) ? (STATUS_ZONES[over.id] === "WON" ? "Won" : "Lost") : stageById(over.id)?.name;
      return name ? dragAnnouncements.onDragOver(card.title, name) : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const card = cardById(active.id);
      if (!card) return undefined;
      const from = stageById(card.stageId)?.name ?? "";
      if (!over || over.id === card.stageId) return dragAnnouncements.onDragCancel(card.title, from);
      // The status toast or the dialog that opens speaks for these.
      if (isZone(over.id)) return undefined;
      const target = stageById(over.id);
      if (!target || needsValueFirst(card, target)) return undefined;
      return dragAnnouncements.onDragEnd(card.title, target.name);
    },
    onDragCancel: ({ active }) => {
      const card = cardById(active.id);
      return card ? dragAnnouncements.onDragCancel(card.title, stageById(card.stageId)?.name ?? "") : undefined;
    },
  };

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setPointerDrag(!(event.activatorEvent instanceof KeyboardEvent));
  }

  function endDrag() {
    setActiveId(null);
    setPointerDrag(false);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    endDrag();
    const card = cardById(active.id);
    if (!card || !over) return;
    if (isZone(over.id)) {
      void moves.setStatus(card, STATUS_ZONES[over.id], removeHooks(card.id));
      return;
    }
    const target = stageById(over.id);
    if (!target || target.id === card.stageId) return;
    void moves.move(card, target, moveHooks(card.id, target.id));
  }

  const activeCard = activeId ? cardById(activeId) : null;
  const activeDays = activeCard ? daysInStage(new Date(activeCard.stageEnteredAt), now) : 0;
  const activeRotting = activeCard ? isRotting(activeDays, stageById(activeCard.stageId)?.rottingDays ?? null) : false;

  return (
    <DndContext
      id="sales-deals-board"
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{ announcements, screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      <div className="relative flex min-h-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain px-4 pt-2.5 pb-4 max-sm:snap-x max-sm:snap-mandatory max-sm:gap-2.5">
        {columns.map((column, index) => (
          <StageColumn
            key={column.stage.id}
            column={column}
            highlight={activeCard !== null && activeCard.stageId !== column.stage.id}
            onOpenList={onOpenList}
            empty={index === 0 && emptyState ? emptyState : null}
            first={index === 0}
            // The empty pipeline already offers "+ Deal" once, in the first column.
            onNewDeal={emptyState ? null : onNewDeal}
          >
            {column.cards.map((card) => (
              <li key={card.id}>
                <DealCard
                  card={card}
                  stage={column.stage}
                  stages={stages}
                  now={now}
                  ownerName={ownerName(card.ownerId)}
                  viewer={viewer}
                  actions={actions}
                />
              </li>
            ))}
          </StageColumn>
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <div className={cn(CARD_CLASS, "h-full w-full cursor-grabbing border-primary shadow-lg scale-[1.02] motion-reduce:scale-100")}>
            <DealCardFace
              card={activeCard}
              days={activeDays}
              rotting={activeRotting}
              now={now}
              ownerName={ownerName(activeCard.ownerId)}
            />
          </div>
        ) : null}
      </DragOverlay>

      <DropBar visible={activeId !== null && pointerDrag} />
    </DndContext>
  );
}

function StageColumn({
  column,
  highlight,
  onOpenList,
  empty,
  first,
  onNewDeal,
  children,
}: {
  column: BoardColumn;
  /** A card from another column is being dragged: show this one can take it. */
  highlight: boolean;
  onOpenList: () => void;
  empty: React.ReactNode | null;
  /** The pipeline's first stage, where a new deal starts. */
  first: boolean;
  onNewDeal: (() => void) | null;
  children: React.ReactNode;
}) {
  const { stage, count, totalCents, cards } = column;
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { kind: "stage" } });

  return (
    <section
      ref={setNodeRef}
      aria-label={`${stage.name}, ${count} ${count === 1 ? "deal" : "deals"}`}
      className={cn(
        "flex min-h-0 max-w-[300px] flex-[1_0_240px] flex-col rounded-[10px] bg-muted/40 transition-[background-color,outline-color] duration-100",
        "max-sm:max-w-none max-sm:flex-[0_0_84%] max-sm:snap-center",
        highlight && isOver && "bg-accent outline-2 -outline-offset-2 outline-primary outline-dashed",
      )}
    >
      <header className="relative border-b-2 px-[11px] pt-[9px] pb-2" title={`Win chance ${stage.probability}%`}>
        <h2 className="truncate text-[13px] font-semibold">{stage.name}</h2>
        <p className="text-xs text-muted-foreground tabular-nums">{dealsSummary(totalCents, count)}</p>
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 left-0 h-0.5 bg-primary"
          style={{ width: `${stage.probability}%` }}
        />
      </header>
      <div className="relative flex min-h-[120px] flex-1 flex-col overflow-y-auto overscroll-y-contain p-2">
        {cards.length > 0 ? (
          <ul className="flex flex-col gap-[7px]">{children}</ul>
        ) : (
          (empty ?? <EmptyColumn stageName={stage.name} first={first} onNewDeal={onNewDeal} />)
        )}
      </div>
      {count > cards.length && cards.length > 0 ? (
        <footer className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t px-[11px] py-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            Showing {cards.length} of {count}.
          </span>
          <Button variant="link" size="xs" onClick={onOpenList} className="h-auto px-0 pointer-coarse:min-h-10">
            Open list view
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

/**
 * An empty column: the mockup's line, then (Decision 20, spec 7.12) what
 * belongs here and a small "+ Deal". Add deal starts a deal in the first
 * stage (spec rule 1), so later stages say how deals arrive instead.
 */
function EmptyColumn({ stageName, first, onNewDeal }: { stageName: string; first: boolean; onNewDeal: (() => void) | null }) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-[18px] text-center text-xs leading-normal text-muted-foreground">
      <p>
        No deals in {stageName} yet.
        {onNewDeal ? (
          <>
            <br />
            {first ? "New deals start here." : "Move a deal here when it reaches this stage."}
          </>
        ) : null}
      </p>
      {onNewDeal ? (
        <Button variant="outline" size="xs" onClick={onNewDeal} aria-label="Add deal" className="pointer-coarse:min-h-10">
          <Plus aria-hidden="true" />
          Deal
        </Button>
      ) : null}
    </div>
  );
}

/** Fixed to the bottom while a card is dragged with the mouse: drop on Lost or Won to change the status. */
function DropBar({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex justify-center gap-2.5 border-t bg-background/85 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur-[6px]",
        "transition-[translate,opacity,visibility] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity,visibility]",
        visible ? "visible translate-y-0 opacity-100" : "pointer-events-none invisible translate-y-full opacity-0 motion-reduce:translate-y-0",
      )}
    >
      <StatusZone id="zone-lost" label="Lost" />
      <StatusZone id="zone-won" label="Won" />
    </div>
  );
}

function StatusZone({ id, label }: { id: ZoneId; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { kind: "status" } });
  const won = STATUS_ZONES[id] === "WON";
  const Icon = won ? Check : X;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-[54px] flex-[0_1_220px] items-center justify-center gap-2 rounded-[10px] border-2 border-dashed font-bold transition-colors duration-100 max-sm:h-12",
        // Won is green-700 on light (4.9:1 for its label; green-600 is 3.2:1) and when filled (Decision 34).
        won
          ? "border-green-700 text-green-700 dark:border-green-500 dark:text-green-500"
          : "border-red-600 text-red-600 dark:border-red-400 dark:text-red-400",
        isOver && (won ? "bg-green-700 text-white dark:bg-green-700 dark:text-white" : "bg-red-600 text-white dark:bg-red-600 dark:text-white"),
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </div>
  );
}
