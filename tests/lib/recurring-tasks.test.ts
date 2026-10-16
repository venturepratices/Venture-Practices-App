import { describe, expect, it, vi } from "vitest";

// computeNextDeadline is pure date math; the module's database client is only
// used by maybeCreateNextOccurrence, so stub it rather than open a connection.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { computeNextDeadline } from "@/lib/recurring-tasks";
import { dateInputValue, deadlineFromDateInput } from "@/lib/utils";

function next(date: string, occurrence: Parameters<typeof computeNextDeadline>[1]) {
  const result = computeNextDeadline(deadlineFromDateInput(date), occurrence, null, null);
  return result ? dateInputValue(result) : null;
}

describe("computeNextDeadline", () => {
  // Ashley's real case: "November Social Media", due Oct 28, came back as
  // Dec 28 because Bi-Monthly meant every 2 months. The team means 2 weeks.
  it("repeats Bi-Monthly (labeled Every 2 Weeks) 14 days after the old due date", () => {
    expect(next("2026-10-28", "RECURRING_BIMONTHLY")).toBe("2026-11-11");
  });

  it("crosses a month and a year boundary for Every 2 Weeks", () => {
    expect(next("2026-12-25", "RECURRING_BIMONTHLY")).toBe("2027-01-08");
  });

  it("leaves the other cadences unchanged", () => {
    expect(next("2026-10-28", "RECURRING_WEEKLY")).toBe("2026-11-04");
    expect(next("2026-10-28", "RECURRING_MONTHLY")).toBe("2026-11-28");
    expect(next("2026-10-28", "RECURRING_QUARTERLY")).toBe("2027-01-28");
  });

  it("does not repeat a non-recurring task", () => {
    expect(next("2026-10-28", "NON_RECURRING")).toBeNull();
  });
});
