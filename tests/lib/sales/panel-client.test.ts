import { describe, expect, it } from "vitest";

import {
  centeredScrollLeft,
  composerDueDate,
  DEAL_PANEL_SHEET_CLASS,
  dealPanelOpen,
  groupTimelineByDay,
  holdEscapeForDraft,
  lostHeadline,
  needsNextStepPrompt,
  stageCaption,
} from "@/lib/sales/panel-client";
import type { TimelineEntry } from "@/lib/sales/timeline";
import { cn } from "@/lib/utils";

function entry(id: string, at: string): TimelineEntry {
  return { id, at, actorType: "USER", actorName: "Sarah K.", icon: "stage", text: "Moved to Demo Complete" };
}

const now = new Date("2026-11-06T04:30:00Z"); // Nov 5, 11:30 PM Eastern

describe("groupTimelineByDay", () => {
  it("groups history by Eastern day, newest first", () => {
    const groups = groupTimelineByDay(
      [entry("e1", "2026-11-06T03:00:00Z"), entry("e2", "2026-11-04T15:00:00Z"), entry("e3", "2026-11-03T15:00:00Z")],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Nov 3"]);
  });

  it("keeps entries of one Eastern day together, in the order they came", () => {
    // 04:10 UTC on Nov 6 is still Nov 5 in Eastern, so all three are "Today".
    const groups = groupTimelineByDay(
      [entry("e1", "2026-11-06T04:10:00Z"), entry("e2", "2026-11-05T20:00:00Z"), entry("e3", "2026-11-05T05:00:00Z")],
      now,
    );
    expect(groups).toEqual([{ label: "Today", entries: [expect.objectContaining({ id: "e1" }), expect.objectContaining({ id: "e2" }), expect.objectContaining({ id: "e3" })] }]);
  });

  it("gives no groups for no history", () => {
    expect(groupTimelineByDay([], now)).toEqual([]);
  });
});

describe("composerDueDate", () => {
  it("turns due choices into Eastern dates", () => {
    expect(composerDueDate("today", "2026-11-05", "")).toBe("2026-11-05");
    expect(composerDueDate("tomorrow", "2026-11-05", "")).toBe("2026-11-06");
    expect(composerDueDate("2-days", "2026-11-05", "")).toBe("2026-11-07");
    expect(composerDueDate("next-week", "2026-11-05", "")).toBe("2026-11-12");
    expect(composerDueDate("pick", "2026-11-05", "2026-12-01")).toBe("2026-12-01");
    expect(composerDueDate("pick", "2026-11-05", "")).toBeNull();
  });

  it("crosses month and year ends on the calendar", () => {
    expect(composerDueDate("tomorrow", "2026-11-30", "")).toBe("2026-12-01");
    expect(composerDueDate("next-week", "2026-12-28", "")).toBe("2027-01-04");
  });

  it("refuses a picked date that is not a real day", () => {
    expect(composerDueDate("pick", "2026-11-05", "2026-02-30")).toBeNull();
  });
});

describe("needsNextStepPrompt", () => {
  it("prompts for a next step only on open deals with nothing left", () => {
    expect(needsNextStepPrompt({ status: "OPEN", openActivityCount: 0 })).toBe(true);
    expect(needsNextStepPrompt({ status: "OPEN", openActivityCount: 1 })).toBe(false);
    expect(needsNextStepPrompt({ status: "WON", openActivityCount: 0 })).toBe(false);
    expect(needsNextStepPrompt({ status: "LOST", openActivityCount: 0 })).toBe(false);
  });
});

describe("stageCaption", () => {
  it("captions an open deal's stage like the mockup", () => {
    expect(stageCaption("Demo Complete", 1, 30, "OPEN")).toBe("Demo Complete · 1 day in this stage · 30% win chance");
    expect(stageCaption("Follow-Up", 9, 85, "OPEN")).toBe("Follow-Up · 9 days in this stage · 85% win chance");
  });

  it("says 0 days for a deal that entered today", () => {
    expect(stageCaption("New Lead", 0, 10, "OPEN")).toBe("New Lead · 0 days in this stage · 10% win chance");
  });

  it("gives a closed deal its status instead of the stage's win chance and clock (C3)", () => {
    // A lost deal in Contract Signed used to read "0 days in this stage · 100% win chance".
    expect(stageCaption("Contract Signed", 0, 100, "LOST")).toBe("Lost · Contract Signed");
    expect(stageCaption("Contract Signed", 3, 100, "WON")).toBe("Won · Contract Signed");
  });
});

describe("lostHeadline", () => {
  it("names the reason picked in the Lost dialog", () => {
    expect(lostHeadline("Price")).toBe("Lost: Price.");
    expect(lostHeadline("Chose a competitor")).toBe("Lost: Chose a competitor.");
  });

  it("still says Lost when no reason was stored (an imported deal)", () => {
    expect(lostHeadline(null)).toBe("Lost.");
    expect(lostHeadline("  ")).toBe("Lost.");
  });
});

describe("dealPanelOpen", () => {
  it("opens while the URL names a deal and no close is on its way", () => {
    expect(dealPanelOpen("deal-a", false)).toBe(true);
    expect(dealPanelOpen(null, false)).toBe(false);
  });

  it("hides at once when closed, before the URL has caught up", () => {
    // Esc pressed: the URL still says deal-a until the server answers the close.
    expect(dealPanelOpen("deal-a", true)).toBe(false);
    expect(dealPanelOpen(null, true)).toBe(false);
  });

  it("opens a deal again when it is reopened before its close landed", () => {
    // Esc on deal A, then a click on card A before the close came back. The
    // reopen replaces the close, so the URL never loses deal=A. Once the router
    // settles the close is no longer on its way, and A must show again; a
    // remembered "this deal was dismissed" would keep it shut for good.
    const seen = [dealPanelOpen("deal-a", false), dealPanelOpen("deal-a", true), dealPanelOpen("deal-a", false)];
    expect(seen).toEqual([true, false, true]);
  });
});

describe("DEAL_PANEL_SHEET_CLASS", () => {
  it("overrides the Sheet's default width so the panel is full screen on phones and 560px on desktop", () => {
    // the two width classes SheetContent applies for side="right" (src/components/ui/sheet.tsx)
    const merged = cn("data-[side=right]:w-3/4 data-[side=right]:sm:max-w-sm", DEAL_PANEL_SHEET_CLASS).split(" ");
    expect(merged).not.toContain("data-[side=right]:w-3/4");
    expect(merged).not.toContain("data-[side=right]:sm:max-w-sm");
    expect(merged).toEqual(expect.arrayContaining(["data-[side=right]:w-full", "data-[side=right]:sm:max-w-[560px]"]));
  });
});

describe("centeredScrollLeft (the stage bar on phones, C4)", () => {
  // A 343px wide bar whose chevrons run to 760px: it scrolls 417px at most.
  it("scrolls the current stage to the middle of the bar", () => {
    // A chevron 120px wide starting at 400px: its middle (460) sits at the bar's middle (171.5).
    expect(centeredScrollLeft({ start: 400, width: 120 }, { width: 343, scrollWidth: 760 })).toBe(288.5);
  });

  it("stays at the start for an early stage, and stops at the end for a late one", () => {
    expect(centeredScrollLeft({ start: 0, width: 100 }, { width: 343, scrollWidth: 760 })).toBe(0);
    expect(centeredScrollLeft({ start: 660, width: 100 }, { width: 343, scrollWidth: 760 })).toBe(417);
  });

  it("does not scroll a bar that fits (desktop)", () => {
    expect(centeredScrollLeft({ start: 300, width: 80 }, { width: 524, scrollWidth: 524 })).toBe(0);
  });
});

describe("holdEscapeForDraft (Esc in the composer, F3)", () => {
  // A key press as React hands it to the composer, recording whether it was stopped before the panel's own Esc handler.
  function press(key: string, isComposing = false) {
    const seen = { stopped: false, prevented: false };
    const event = {
      key,
      nativeEvent: { isComposing },
      stopPropagation: () => {
        seen.stopped = true;
      },
      preventDefault: () => {
        seen.prevented = true;
      },
    };
    return { event, seen };
  }

  it("holds Esc while a subject is typed: the panel stays open and the draft stays", () => {
    // Typed a note, pressed Esc: the whole panel closed and the note was gone.
    const { event, seen } = press("Escape");
    expect(holdEscapeForDraft(event, ["Call about the proposal", ""])).toBe(true);
    expect(seen).toEqual({ stopped: true, prevented: true });
  });

  it("holds Esc while a note is typed on the other tab too", () => {
    const { event, seen } = press("Escape");
    expect(holdEscapeForDraft(event, ["", "Asked for a second quote"])).toBe(true);
    expect(seen.stopped).toBe(true);
  });

  it("lets Esc close the panel as before when nothing is typed (spaces count as nothing)", () => {
    const { event, seen } = press("Escape");
    expect(holdEscapeForDraft(event, ["", "  \n "])).toBe(false);
    expect(seen).toEqual({ stopped: false, prevented: false });
  });

  it("leaves every other key alone", () => {
    const { event, seen } = press("Enter");
    expect(holdEscapeForDraft(event, ["Call about the proposal", ""])).toBe(false);
    expect(seen).toEqual({ stopped: false, prevented: false });
  });

  it("leaves Esc to the keyboard while it is composing a word (IME)", () => {
    const { event, seen } = press("Escape", true);
    expect(holdEscapeForDraft(event, ["電話", ""])).toBe(false);
    expect(seen).toEqual({ stopped: false, prevented: false });
  });
});
