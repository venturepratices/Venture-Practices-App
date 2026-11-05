import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PanelActivity } from "@/lib/sales/deal-panel";
import { NextSteps } from "@/components/sales/next-steps";

// A server render of the deal panel's "Next steps" list. Node has no browser,
// so this cannot tick anything; it proves each row says what it is and when.

const NOW = new Date("2026-11-05T15:00:00.000Z");

function activity(extra: Partial<PanelActivity>): PanelActivity {
  return {
    id: "a1",
    type: "MEETING",
    subject: "Demo",
    dueAt: "2026-11-06T19:00:00.000Z",
    hasTime: true,
    createdBy: "u1",
    ownerId: "u1",
    ...extra,
  };
}

function render(activities: PanelActivity[]) {
  return renderToString(
    createElement(NextSteps, { activities, now: NOW, canEdit: true, onMarkDone: async () => {} }),
  ).replaceAll("<!-- -->", "");
}

describe("Next steps (server render)", () => {
  it("says the chosen time after the day", () => {
    // Tomorrow at 19:00 UTC is 2 PM Eastern.
    expect(render([activity({})])).toContain("Meeting · Tomorrow, 2:00 PM");
  });

  it("says only the day when no time was chosen", () => {
    const html = render([activity({ type: "CALL", hasTime: false, dueAt: "2026-11-07T04:59:59.999Z" })]);
    expect(html).toContain("Call · Tomorrow</p>");
  });

  it("still marks an overdue one, with its day and time", () => {
    const html = render([activity({ type: "TASK", dueAt: "2026-11-04T14:30:00.000Z" })]);
    expect(html).toContain("Task · Yesterday, 9:30 AM (overdue)");
  });
});
