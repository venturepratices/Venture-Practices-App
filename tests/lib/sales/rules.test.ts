import { describe, expect, it } from "vitest";
import { dateInputValue, endOfDay } from "@/lib/utils";
import { activitiesOnStageEntry, checkStageMove, isStalled, territoryHoldCheckDate } from "@/lib/sales/rules";

describe("checkStageMove", () => {
  const needsValue = { requiresValue: true };

  it("blocks a $0 deal entering a stage that requires value", () => {
    expect(checkStageMove({ valueCents: 0, mrrCents: 0 }, needsValue)).toEqual({
      code: "PROPOSAL_NEEDS_VALUE",
      message: "Add the total value and monthly value before moving to Proposal Sent.",
    });
  });

  it("blocks when the total is set but the monthly value is $0", () => {
    expect(checkStageMove({ valueCents: 500000, mrrCents: 0 }, needsValue)?.code).toBe("PROPOSAL_NEEDS_VALUE");
  });

  it("blocks when the monthly value is set but the total is $0", () => {
    expect(checkStageMove({ valueCents: 0, mrrCents: 150000 }, needsValue)?.code).toBe("PROPOSAL_NEEDS_VALUE");
  });

  it("allows the move when both values are set", () => {
    expect(checkStageMove({ valueCents: 500000, mrrCents: 150000 }, needsValue)).toBeNull();
  });

  it("allows a $0 deal into a stage that does not require value", () => {
    expect(checkStageMove({ valueCents: 0, mrrCents: 0 }, { requiresValue: false })).toBeNull();
  });
});

describe("activitiesOnStageEntry", () => {
  it("creates nothing for an ordinary stage", () => {
    expect(activitiesOnStageEntry({ isNoShow: false }, new Date("2026-11-05T15:00:00Z"))).toEqual([]);
  });

  it("creates one reschedule call due end of today for No Show", () => {
    // 22:30Z is 5:30pm in New York, so "today" is still Nov 5 there (UTC is already Nov 5 too).
    const result = activitiesOnStageEntry({ isNoShow: true }, new Date("2026-11-05T22:30:00Z"));
    expect(result).toEqual([
      {
        type: "CALL",
        subject: "Reschedule the missed demo",
        dueAt: endOfDay("2026-11-05"),
        hasTime: false,
        createdBy: "rule:no-show",
      },
    ]);
    expect(dateInputValue(result[0].dueAt)).toBe("2026-11-05");
  });

  it("uses the app calendar day, not the UTC day, late in the evening", () => {
    // 02:30Z on Nov 6 is 9:30pm on Nov 5 in New York.
    const [activity] = activitiesOnStageEntry({ isNoShow: true }, new Date("2026-11-06T02:30:00Z"));
    expect(dateInputValue(activity.dueAt)).toBe("2026-11-05");
  });
});

describe("territoryHoldCheckDate", () => {
  it("is 7 days before the expiry, at the end of that day", () => {
    const check = territoryHoldCheckDate(endOfDay("2026-11-19"));
    expect(dateInputValue(check)).toBe("2026-11-12");
    expect(check.getTime()).toBe(endOfDay("2026-11-12").getTime());
  });

  it("lands on the right calendar day across the March daylight saving change", () => {
    // Clocks spring forward on 2026-03-08 in New York: a week before Mar 11 is Mar 4,
    // but a plain 7 x 24 hour subtraction would give 11pm on Mar 3.
    const check = territoryHoldCheckDate(endOfDay("2026-03-11"));
    expect(dateInputValue(check)).toBe("2026-03-04");
    expect(check.getTime()).toBe(endOfDay("2026-03-04").getTime());
  });

  it("handles an expiry on the daylight saving change day itself", () => {
    const check = territoryHoldCheckDate(endOfDay("2026-03-08"));
    expect(dateInputValue(check)).toBe("2026-03-01");
    expect(check.getTime()).toBe(endOfDay("2026-03-01").getTime());
  });
});

describe("isStalled", () => {
  it("is true for an open deal with no open activities", () => {
    expect(isStalled(0, "OPEN")).toBe(true);
  });

  it("is false for an open deal with at least one open activity", () => {
    expect(isStalled(1, "OPEN")).toBe(false);
  });

  it("is false for won and lost deals", () => {
    expect(isStalled(0, "WON")).toBe(false);
    expect(isStalled(0, "LOST")).toBe(false);
  });
});
