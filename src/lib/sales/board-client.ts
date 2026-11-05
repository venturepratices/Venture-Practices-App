import type { BoardColumn } from "@/lib/sales/board";
import type { BoardQuery } from "@/lib/sales/board-query";
import { BOARD_COLUMN_LIMIT } from "@/lib/sales/constants";
import { formatMoney } from "@/lib/sales/format";

// The Deals board's client-side logic: optimistic moves, the toolbar's URL
// building, "Show more" paging, keyboard drag and the words the board says.
// Pure functions with no React and no server imports (the type imports above
// are erased at build time), so they are unit tested and safe in the browser.

// --- Optimistic board changes ---

/**
 * The board after moving one card to another stage, before the server answers.
 * The card goes to the top of the target column with `stageEnteredAt: nowIso`,
 * which is where the server's newest-in-stage order puts it after the refresh
 * (Decision 31); a full column still shows only its first 50. Both columns'
 * count and total follow the card. The input is never changed; an unknown deal,
 * an unknown stage or the stage the deal is already in gives the board back as is.
 */
export function applyOptimisticMove(
  columns: BoardColumn[],
  dealId: string,
  toStageId: string,
  nowIso: string,
): BoardColumn[] {
  const from = columns.find((column) => column.cards.some((card) => card.id === dealId));
  const card = from?.cards.find((c) => c.id === dealId);
  if (!from || !card || from.stage.id === toStageId || !columns.some((column) => column.stage.id === toStageId)) {
    return columns;
  }
  const moved = { ...card, stageId: toStageId, stageEnteredAt: nowIso };

  return columns.map((column) => {
    if (column === from) {
      return {
        ...column,
        count: column.count - 1,
        totalCents: column.totalCents - card.valueCents,
        cards: column.cards.filter((c) => c.id !== dealId),
      };
    }
    if (column.stage.id === toStageId) {
      return {
        ...column,
        count: column.count + 1,
        totalCents: column.totalCents + card.valueCents,
        cards: [moved, ...column.cards].slice(0, BOARD_COLUMN_LIMIT),
      };
    }
    return column;
  });
}

/** The board after a card leaves it (marked won or lost from the open board), before the server answers. Input untouched. */
export function applyOptimisticRemove(columns: BoardColumn[], dealId: string): BoardColumn[] {
  return columns.map((column) => {
    const card = column.cards.find((c) => c.id === dealId);
    if (!card) return column;
    return {
      ...column,
      count: column.count - 1,
      totalCents: column.totalCents - card.valueCents,
      cards: column.cards.filter((c) => c.id !== dealId),
    };
  });
}

// --- The toolbar's URL ---

/**
 * The board query after one toolbar change. It always names the pipeline the
 * page is showing (`resolvedPipelineKey`), so after any click the URL names a
 * pipeline and the saved view, which applies only to a bare /sales/deals, can
 * never undo the click (Decision 13). Paging always starts again.
 */
export function nextBoardQuery(
  current: BoardQuery,
  resolvedPipelineKey: string,
  patch: Partial<Omit<BoardQuery, "cursor">>,
): BoardQuery {
  return { ...current, pipeline: resolvedPipelineKey, ...patch, cursor: null };
}

/** How many of the Filter menu's own choices (Status, Next step) differ from the defaults. */
export function activeFilterCount(query: BoardQuery): number {
  return (query.status !== "open" ? 1 : 0) + (query.next !== "any" ? 1 : 0);
}

/** True when the Filter menu or the search narrows the board ("Clear filters" undoes these). */
export function hasActiveFilters(query: BoardQuery): boolean {
  return activeFilterCount(query) > 0 || query.q !== "";
}

// --- "Show more" ---

/** The rows already shown, then the rows of the next page that are not shown yet (a refresh can shift a row across pages). */
export function appendPage<T extends { id: string }>(rows: T[], next: T[]): T[] {
  const seen = new Set(rows.map((row) => row.id));
  const added: T[] = [];
  for (const row of next) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    added.push(row);
  }
  return [...rows, ...added];
}

// --- Moves and their rules ---

/** A stage that needs a price (Proposal Sent) opens the value dialog first when either stored value is $0. */
export function needsValueFirst(
  deal: { valueCents: number; mrrCents: number },
  target: { requiresValue: boolean },
): boolean {
  return target.requiresValue && (deal.valueCents === 0 || deal.mrrCents === 0);
}

/** The deal owner or an admin may change a deal (Decision 15); everyone else only looks. */
export function canChangeDeal(viewer: { userId: string; isAdmin: boolean }, deal: { ownerId: string }): boolean {
  return viewer.isAdmin || deal.ownerId === viewer.userId;
}

/**
 * The toast after a stage move (mockup wording), and whether it offers "Mark
 * won" or "Mark lost" because the stage is flagged won or lost (Decision 3).
 * Entering No Show mentions the reschedule call only when the rule added one.
 */
export function moveToast(
  stage: { name: string; isNoShow: boolean; isWon: boolean; isLost: boolean },
  addedRescheduleCall = true,
): { message: string; offer: "won" | "lost" | null } {
  const extra = stage.isNoShow && addedRescheduleCall ? " Reschedule call added for today." : "";
  return {
    message: `Moved to ${stage.name}.${extra}`,
    offer: stage.isWon ? "won" : stage.isLost ? "lost" : null,
  };
}

// --- Keyboard drag ---

/** The column a keyboard drag lands on after an arrow key: one to the left or right, stopping at the ends. Other keys stay put. */
export function nextColumnIndex(current: number, key: string, count: number): number {
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  return Math.max(0, Math.min(count - 1, current + step));
}

/** What screen readers hear while a card is dragged (spec 7.11). */
export const dragAnnouncements = {
  onDragStart: (title: string) =>
    `Picked up ${title}. Use the left and right arrow keys to pick a stage, Space to drop, Escape to cancel.`,
  onDragOver: (title: string, stageName: string) => `${title} is over ${stageName}.`,
  onDragEnd: (title: string, stageName: string) => `${title} moved to ${stageName}.`,
  onDragCancel: (title: string, stageName: string) => `Move cancelled. ${title} stays in ${stageName}.`,
};

/** Read out when a card gets keyboard focus (dnd-kit's screen reader instructions). */
export const DRAG_INSTRUCTIONS =
  "Press Enter to open this deal. To move it, press Space to pick it up, the left and right arrow keys to pick a stage, Space to drop it, or Escape to cancel.";

// --- Words and numbers ---

/** "$14,400 · 3 deals": a column header or the toolbar summary. */
export function dealsSummary(totalCents: number, count: number): string {
  return `${formatMoney(totalCents)} · ${count} ${count === 1 ? "deal" : "deals"}`;
}

/** What a money box starts with: the stored value in dollars ("14400", "14400.50"), or blank for $0. */
export function moneyInputValue(cents: number): string {
  if (cents <= 0) return "";
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(dollars) : `${dollars}.${String(rest).padStart(2, "0")}`;
}

/** Avatar letters: first and last initial ("Ben Shaver" -> "BS", "Sarah K." -> "SK"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}
