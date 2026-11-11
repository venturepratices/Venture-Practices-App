import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TimelineEntry } from "@/lib/sales/timeline";

// A server render of the deal panel's History (deal-history.tsx). Node has no
// browser, so this cannot edit a note; it proves each line says who did it
// and when, as text a phone and a screen reader can read (spec 7.8, F4). The
// time used to sit only in a hover title, which touch screens never show.

const { DealHistory } = await import("@/components/sales/deal-history");

const NOW = new Date("2026-11-05T21:00:00.000Z"); // Nov 5, 4:00 PM Eastern

function entry(id: string, at: string, extra: Partial<TimelineEntry> = {}): TimelineEntry {
  return { id, at, actorType: "USER", actorName: "Sarah K.", icon: "stage", text: "Moved to Demo Complete", ...extra };
}

function render(entries: TimelineEntry[]): string {
  return renderToString(
    createElement(DealHistory, {
      history: { status: "ready", entries, hasOlder: false, loadingOlder: false },
      now: NOW,
      onShowOlder: vi.fn(),
      onRetry: vi.fn(),
      onSaved: vi.fn(),
    }),
  ).replaceAll("<!-- -->", "");
}

/** The small line under an entry, without its tags: "Sarah K. · 2:05 PM". */
function bylines(html: string): string[] {
  return [...html.matchAll(/<p class="m-0 text-xs text-muted-foreground">([\s\S]*?)<\/p>/g)].map((match) =>
    match[1].replace(/<[^>]+>/g, ""),
  );
}

describe("deal history: who and when on every line (F4)", () => {
  it("shows the clock time, in app time, beside who did it", () => {
    const html = render([
      entry("e1", "2026-11-05T19:05:00.000Z"), // today, 2:05 PM Eastern
      entry("e2", "2026-11-04T14:30:00.000Z", { actorType: "SYSTEM", actorName: null }), // yesterday, 9:30 AM (EST)
      entry("e3", "2026-10-20T22:15:00.000Z", { actorName: "Ben S." }), // Oct 20, 6:15 PM (EDT)
    ]);
    expect(bylines(html)).toEqual(["Sarah K. · 2:05 PM", "Sales rule · 9:30 AM", "Ben S. · 6:15 PM"]);
  });

  it("keeps the day in each group's header, and the exact moment in the time's markup", () => {
    const html = render([entry("e1", "2026-11-05T19:05:00.000Z"), entry("e3", "2026-10-20T22:15:00.000Z")]);
    expect(html).toContain(">Today</h4>");
    expect(html).toContain(">Oct 20</h4>");
    expect(html).toMatch(/<time dateTime="2026-11-05T19:05:00.000Z"[^>]*>2:05 PM<\/time>/);
  });
});
