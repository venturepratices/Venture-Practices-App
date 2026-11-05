import { describe, expect, it } from "vitest";

import type { BoardCard, BoardColumn, BoardStage } from "@/lib/sales/board";
import {
  activeFilterCount,
  appendPage,
  applyOptimisticMove,
  applyOptimisticRemove,
  canChangeDeal,
  checkDealValues,
  dealsSummary,
  dragAnnouncements,
  hasActiveFilters,
  initials,
  moneyInputValue,
  moveToast,
  needsValueFirst,
  nextBoardQuery,
  nextColumnIndex,
  undoMoveBody,
} from "@/lib/sales/board-client";
import { BOARD_COLUMN_LIMIT } from "@/lib/sales/constants";
import { boardQueryToSearch, type BoardQuery } from "@/lib/sales/board-query";

function stage(id: string, extra: Partial<BoardStage> = {}): BoardStage {
  return {
    id,
    key: id,
    name: `Stage ${id}`,
    position: 0,
    probability: 10,
    isWon: false,
    isLost: false,
    requiresValue: false,
    isNoShow: false,
    rottingDays: 14,
    ...extra,
  };
}

function card(id: string, valueCents: number): BoardCard {
  return {
    id,
    title: `Deal ${id}`,
    valueCents,
    mrrCents: 0,
    stageId: "",
    status: "OPEN",
    stageEnteredAt: "2026-11-01T15:00:00.000Z",
    ownerId: "u1",
    personName: "Sarah K.",
    organizationName: null,
    next: null,
  };
}

/** A column whose count and total match the cards it shows. */
function col(stageId: string, cards: BoardCard[]): BoardColumn {
  return {
    stage: stage(stageId),
    count: cards.length,
    totalCents: cards.reduce((sum, c) => sum + c.valueCents, 0),
    cards: cards.map((c) => ({ ...c, stageId })),
  };
}

describe("applyOptimisticMove", () => {
  it("moves a card optimistically without touching the input", () => {
    const columns = [col("s4", [card("d1", 0)]), col("s5", [card("d2", 1440000)])];
    const next = applyOptimisticMove(columns, "d1", "s5", "2026-11-05T15:00:00.000Z");
    expect(next[0]).toMatchObject({ count: 0, totalCents: 0, cards: [] });
    expect(next[1].cards.map((c) => c.id)).toEqual(["d1", "d2"]);
    expect(next[1].cards[0]).toMatchObject({ stageId: "s5", stageEnteredAt: "2026-11-05T15:00:00.000Z" });
    expect(next[1]).toMatchObject({ count: 2, totalCents: 1440000 });
    expect(columns[0].cards).toHaveLength(1);
  });

  it("carries the card's value from one column total to the other", () => {
    const columns = [col("s1", [card("d1", 500000), card("d3", 100)]), col("s2", [card("d2", 200)])];
    const next = applyOptimisticMove(columns, "d1", "s2", "2026-11-05T15:00:00.000Z");
    expect(next[0]).toMatchObject({ count: 1, totalCents: 100 });
    expect(next[1]).toMatchObject({ count: 2, totalCents: 500200 });
  });

  it("keeps a full column at the 50 it shows, the moved card on top", () => {
    const full = Array.from({ length: BOARD_COLUMN_LIMIT }, (_, i) => card(`f${i}`, 100));
    const columns = [col("s1", [card("d1", 0)]), { ...col("s2", full), count: 60 }];
    const next = applyOptimisticMove(columns, "d1", "s2", "2026-11-05T15:00:00.000Z");
    expect(next[1].cards).toHaveLength(BOARD_COLUMN_LIMIT);
    expect(next[1].cards[0].id).toBe("d1");
    expect(next[1].count).toBe(61);
  });

  it("changes nothing for an unknown deal or the stage it is already in", () => {
    const columns = [col("s1", [card("d1", 100)]), col("s2", [])];
    expect(applyOptimisticMove(columns, "nope", "s2", "2026-11-05T15:00:00.000Z")).toEqual(columns);
    expect(applyOptimisticMove(columns, "d1", "s1", "2026-11-05T15:00:00.000Z")).toEqual(columns);
    expect(applyOptimisticMove(columns, "d1", "missing-stage", "2026-11-05T15:00:00.000Z")).toEqual(columns);
  });
});

describe("applyOptimisticRemove", () => {
  it("takes a won or lost card off the open board without touching the input", () => {
    const columns = [col("s1", [card("d1", 300), card("d2", 200)]), col("s2", [card("d3", 50)])];
    const next = applyOptimisticRemove(columns, "d1");
    expect(next[0]).toMatchObject({ count: 1, totalCents: 200 });
    expect(next[0].cards.map((c) => c.id)).toEqual(["d2"]);
    expect(next[1]).toEqual(columns[1]);
    expect(columns[0].cards).toHaveLength(2);
  });
});

const DEFAULTS: BoardQuery = { pipeline: null, view: "board", scope: "everyone", status: "open", next: "any", q: "", cursor: null };

describe("nextBoardQuery", () => {
  it("always names the resolved pipeline so a saved view cannot undo a click", () => {
    const next = nextBoardQuery(DEFAULTS, "direct-mail", { view: "board" });
    expect(next).toEqual({ ...DEFAULTS, pipeline: "direct-mail" });
    expect(boardQueryToSearch(next)).toContain("pipeline=direct-mail");
    expect(nextBoardQuery(DEFAULTS, "direct-mail", { scope: "mine" })).toMatchObject({ pipeline: "direct-mail", scope: "mine" });
    expect(nextBoardQuery({ ...DEFAULTS, pipeline: "direct-mail" }, "direct-mail", { pipeline: "new-mover-mail" }).pipeline).toBe(
      "new-mover-mail",
    );
    expect(nextBoardQuery({ ...DEFAULTS, cursor: "d50" }, "direct-mail", { q: "oak" })).toMatchObject({ q: "oak", cursor: null });
  });

  it("keeps the other filters when one changes", () => {
    const current: BoardQuery = { ...DEFAULTS, pipeline: "direct-mail", status: "won", next: "overdue", q: "oak" };
    expect(nextBoardQuery(current, "direct-mail", { view: "list" })).toEqual({ ...current, view: "list" });
  });
});

describe("appendPage", () => {
  it("appends a page without repeating rows", () => {
    expect(appendPage([{ id: "d1" }, { id: "d2" }], [{ id: "d2" }, { id: "d3" }]).map((r) => r.id)).toEqual(["d1", "d2", "d3"]);
  });

  it("keeps the rows already shown as they are", () => {
    const shown = [{ id: "d1", title: "Old" }];
    expect(appendPage(shown, [{ id: "d1", title: "New" }])).toEqual([{ id: "d1", title: "Old" }]);
  });
});

describe("nextColumnIndex", () => {
  it("jumps one column per arrow and stops at the ends", () => {
    expect(nextColumnIndex(2, "ArrowRight", 8)).toBe(3);
    expect(nextColumnIndex(7, "ArrowRight", 8)).toBe(7);
    expect(nextColumnIndex(0, "ArrowLeft", 8)).toBe(0);
    expect(nextColumnIndex(3, "ArrowUp", 8)).toBe(3);
    expect(nextColumnIndex(3, "ArrowLeft", 8)).toBe(2);
  });
});

describe("dragAnnouncements", () => {
  it("announces keyboard drags in plain words", () => {
    expect(dragAnnouncements.onDragStart("Bright Smile Dental")).toBe(
      "Picked up Bright Smile Dental. Use the left and right arrow keys to pick a stage, Space to drop, Escape to cancel.",
    );
    expect(dragAnnouncements.onDragEnd("Bright Smile Dental", "Proposal Sent")).toBe("Bright Smile Dental moved to Proposal Sent.");
    expect(dragAnnouncements.onDragCancel("Bright Smile Dental", "Demo Complete")).toBe(
      "Move cancelled. Bright Smile Dental stays in Demo Complete.",
    );
    expect(dragAnnouncements.onDragOver("Bright Smile Dental", "Follow-Up")).toBe("Bright Smile Dental is over Follow-Up.");
  });
});

describe("moveToast", () => {
  it("words the move toast like the mockup", () => {
    expect(moveToast({ name: "No Show", isNoShow: true, isWon: false, isLost: false })).toEqual({
      message: "Moved to No Show. Reschedule call added for today.",
      offer: null,
    });
    expect(moveToast({ name: "Contract Signed", isNoShow: false, isWon: true, isLost: false })).toEqual({
      message: "Moved to Contract Signed.",
      offer: "won",
    });
    expect(moveToast({ name: "Deal Lost Nurture", isNoShow: false, isWon: false, isLost: true }).offer).toBe("lost");
    expect(moveToast({ name: "Demo Complete", isNoShow: false, isWon: false, isLost: false })).toEqual({
      message: "Moved to Demo Complete.",
      offer: null,
    });
  });

  it("does not claim a reschedule call when the rule added none (one was still open)", () => {
    expect(moveToast({ name: "No Show", isNoShow: true, isWon: false, isLost: false }, false)).toEqual({
      message: "Moved to No Show.",
      offer: null,
    });
  });
});

describe("undoMoveBody", () => {
  it("moves the deal back, marked as an undo so the server puts back its days in stage (F2)", () => {
    expect(undoMoveBody({ previousStageId: "s4", createdActivityIds: [] })).toEqual({ stageId: "s4", undo: true });
  });

  it("names the call the No Show rule just added, to take back with it (Decision 24)", () => {
    expect(undoMoveBody({ previousStageId: "s2", createdActivityIds: ["a1"] })).toEqual({
      stageId: "s2",
      undo: true,
      undoActivityIds: ["a1"],
    });
  });
});

describe("checkDealValues (the value dialog)", () => {
  it("reads both boxes as cents", () => {
    expect(checkDealValues("$14,400", "1200.50", true)).toEqual({ ok: true, values: { valueCents: 1_440_000, mrrCents: 120_050 } });
  });

  it("allows $0 when the stage needs no price", () => {
    expect(checkDealValues("", "", false)).toEqual({ ok: true, values: { valueCents: 0, mrrCents: 0 } });
  });

  it("marks only the monthly value when the total is filled and the monthly is empty (C5)", () => {
    expect(checkDealValues("14400", "", true)).toEqual({
      ok: false,
      message: "The monthly value must be more than $0.",
      invalid: { total: false, monthly: true },
    });
  });

  it("marks only the total when it is the one missing", () => {
    expect(checkDealValues("0", "1200", true)).toEqual({
      ok: false,
      message: "The total value must be more than $0.",
      invalid: { total: true, monthly: false },
    });
  });

  it("marks both when both are missing", () => {
    expect(checkDealValues("", " ", true)).toEqual({
      ok: false,
      message: "Both must be more than $0.",
      invalid: { total: true, monthly: true },
    });
  });

  it("marks only a box that does not hold an amount, before asking for a price", () => {
    expect(checkDealValues("14,40", "", true)).toEqual({
      ok: false,
      message: "Enter an amount like 14,400.",
      invalid: { total: true, monthly: false },
    });
    expect(checkDealValues("14400", "-5", false)).toEqual({
      ok: false,
      message: "Enter an amount like 14,400.",
      invalid: { total: false, monthly: true },
    });
  });
});

describe("needsValueFirst", () => {
  it("asks for both values before a move into a stage that needs them", () => {
    const proposal = { requiresValue: true };
    expect(needsValueFirst({ valueCents: 0, mrrCents: 120000 }, proposal)).toBe(true);
    expect(needsValueFirst({ valueCents: 1440000, mrrCents: 0 }, proposal)).toBe(true);
    expect(needsValueFirst({ valueCents: 1440000, mrrCents: 120000 }, proposal)).toBe(false);
    expect(needsValueFirst({ valueCents: 0, mrrCents: 0 }, { requiresValue: false })).toBe(false);
  });
});

describe("canChangeDeal", () => {
  it("lets the owner or an admin change a deal, nobody else", () => {
    expect(canChangeDeal({ userId: "u1", isAdmin: false }, { ownerId: "u1" })).toBe(true);
    expect(canChangeDeal({ userId: "u2", isAdmin: false }, { ownerId: "u1" })).toBe(false);
    expect(canChangeDeal({ userId: "u2", isAdmin: true }, { ownerId: "u1" })).toBe(true);
  });
});

describe("filters", () => {
  it("counts the Filter menu's own choices, and treats search as a filter too", () => {
    expect(activeFilterCount(DEFAULTS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULTS, status: "won" })).toBe(1);
    expect(activeFilterCount({ ...DEFAULTS, status: "lost", next: "none" })).toBe(2);
    expect(activeFilterCount({ ...DEFAULTS, q: "oak" })).toBe(0);
    expect(hasActiveFilters(DEFAULTS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULTS, q: "oak" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULTS, next: "today" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULTS, scope: "mine", view: "list", pipeline: "direct-mail" })).toBe(false);
  });
});

describe("words and numbers", () => {
  it("sums money and counts deals like the column headers", () => {
    expect(dealsSummary(1440000, 1)).toBe("$14,400 · 1 deal");
    expect(dealsSummary(0, 0)).toBe("$0 · 0 deals");
    expect(dealsSummary(2880050, 3)).toBe("$28,800.50 · 3 deals");
  });

  it("fills a money box with what is stored, blank for nothing", () => {
    expect(moneyInputValue(0)).toBe("");
    expect(moneyInputValue(1440000)).toBe("14400");
    expect(moneyInputValue(1440050)).toBe("14400.50");
    expect(moneyInputValue(5)).toBe("0.05");
  });

  it("makes avatar initials from a name", () => {
    expect(initials("Ben Shaver")).toBe("BS");
    expect(initials("Sarah K.")).toBe("SK");
    expect(initials("robert")).toBe("R");
    expect(initials("  ")).toBe("?");
  });
});
