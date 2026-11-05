import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ActivitiesPageData, ActivityRow } from "@/lib/sales/activities-page";

// A server render of the Activities screen with canned data. Node has no
// browser, so this cannot click anything; it proves the header, filters, rows,
// stacked-card labels and empty states render without throwing and carry the
// labels and words the plan asks for.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/activities",
  useSearchParams: () => new URLSearchParams("when=overdue"),
}));

const { ActivitiesView } = await import("@/components/sales/activities-view");

const NOW = "2026-11-05T15:00:00.000Z";

const CALL: ActivityRow = {
  id: "a1",
  type: "CALL",
  subject: "Follow-up call",
  dueAt: "2026-11-03T15:00:00.000Z",
  hasTime: true,
  doneAt: null,
  ownerId: "u1",
  deal: { id: "d1", title: "Bright Smile Dental", ownerId: "u1" },
};

const MEETING_ON_ROBERTS_DEAL: ActivityRow = {
  id: "a2",
  type: "MEETING",
  subject: "Demo",
  dueAt: "2026-11-05T19:00:00.000Z",
  hasTime: true,
  doneAt: null,
  ownerId: "u2",
  deal: { id: "d2", title: "Oak Family Dentistry", ownerId: "u2" },
};

function pageData(extra: Partial<ActivitiesPageData> = {}): ActivitiesPageData {
  return {
    query: { when: "overdue", type: "all", scope: "everyone", cursor: null },
    rows: [CALL, MEETING_ON_ROBERTS_DEAL],
    nextCursor: null,
    members: [
      { id: "u1", name: "Ben Shaver" },
      { id: "u2", name: "Robert Ortiz" },
    ],
    canSeeEveryone: true,
    ...extra,
  };
}

/** The server HTML, without the comment markers React puts between adjacent text pieces. */
function render(data: ActivitiesPageData, viewer = { userId: "u1", isAdmin: false }) {
  return renderToString(createElement(ActivitiesView, { data, viewer, now: NOW })).replaceAll("<!-- -->", "");
}

/** Each row's Due cell as read out, tags dropped: "Due: Nov 3, 10:00 AM · Done Yesterday, 10:00 AM". */
function dueCells(html: string): string[] {
  return [...html.matchAll(/<td[^>]*>(<span[^>]*>Due: <\/span>[\s\S]*?)<\/td>/g)].map((match) => match[1].replace(/<[^>]+>/g, ""));
}

describe("Activities screen (server render)", () => {
  it("renders the header like the mockup", () => {
    const html = render(pageData());
    expect(html).toContain(">Activities</h1>");
    expect(html).toContain("Calls, meetings and tasks across all your deals.");
    expect(html).toContain("Everyone");
    expect(html).toContain("Just me");
    expect(html).toContain('aria-label="Keyboard shortcuts"');
  });

  it("hides Everyone / Just me for someone who sees only their own deals", () => {
    const html = render(pageData({ canSeeEveryone: false }));
    expect(html).not.toContain("Just me");
    expect(html).toContain('aria-label="Keyboard shortcuts"');
  });

  it("presses the current day filter and offers All plus the six types as icon buttons", () => {
    const html = render(pageData());
    for (const label of ["To do", "Overdue", "Today", "Done"]) expect(html).toContain(`>${label}</button>`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Overdue<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>To do<\/button>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>All<\/button>/);
    for (const type of ["Call", "Meeting", "Task", "Deadline", "Email", "Lunch"]) {
      expect(html).toContain(`aria-label="${type}" title="${type}"`);
    }
  });

  it("presses the type filter that is on", () => {
    const html = render(pageData({ query: { when: "open", type: "MEETING", scope: "mine", cursor: null } }));
    expect(html).toMatch(/aria-label="Meeting" title="Meeting" aria-pressed="true"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>All<\/button>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Just me<\/button>/);
  });

  it("lists activities under the mockup's columns with a check, the deal, the due pill and the owner", () => {
    const html = render(pageData());
    for (const heading of ["Done", "Subject", "Deal", "Due", "Owner"]) expect(html).toContain(`>${heading}</th>`);
    expect(html).toContain('aria-label="Mark done: Follow-up call"');
    expect(html).toContain("Follow-up call");
    expect(html).toContain('href="/sales/activities?when=overdue&amp;deal=d1"');
    expect(html).toContain("Bright Smile Dental");
    expect(html).toContain("Overdue 2d");
    expect(html).toContain('aria-label="Owner: Ben Shaver"');
    for (const label of ["Deal:", "Due:", "Owner:"]) expect(html).toContain(label);
  });

  it("says the chosen time in the Due column, and only the day when none was chosen", () => {
    // Robert's demo is today at 19:00 UTC: 2 PM Eastern.
    expect(render(pageData())).toContain("Today, 2:00 PM");
    const anyTime = render(pageData({ rows: [{ ...MEETING_ON_ROBERTS_DEAL, hasTime: false, dueAt: "2026-11-06T04:59:59.999Z" }] }));
    expect(anyTime).toContain(">Today</span>");
    expect(anyTime).not.toContain("Today,");
  });

  it("keeps someone else's check visible but not usable", () => {
    const html = render(pageData());
    expect(html).toMatch(/aria-label="Mark done: Demo"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/aria-label="Mark done: Follow-up call"[^>]*aria-disabled="true"/);
    // An admin may tick anyone's.
    expect(render(pageData(), { userId: "u9", isAdmin: true })).not.toContain('aria-disabled="true"');
  });

  it("shows done rows with a success check instead of a due pill", () => {
    const done: ActivityRow = { ...CALL, id: "a3", subject: "Intro call", doneAt: "2026-11-04T15:00:00.000Z" };
    const html = render(pageData({ query: { when: "done", type: "all", scope: "everyone", cursor: null }, rows: [done] }));
    expect(html).not.toContain("Mark done: Intro call");
    expect(html).toContain("bg-status-success");
    expect(html).not.toContain("Overdue 2d");
  });

  it("says when a done row was due and when it was done, not just the word Done (C7)", () => {
    // Due Nov 3 at 10 AM Eastern, done yesterday (Nov 4) at 10 AM; and one with no time, done today at 9:05 AM.
    const late: ActivityRow = { ...CALL, id: "a3", subject: "Intro call", doneAt: "2026-11-04T15:00:00.000Z" };
    const anyTime: ActivityRow = {
      ...CALL,
      id: "a4",
      subject: "Send the proposal",
      hasTime: false,
      dueAt: "2026-11-06T04:59:59.999Z",
      doneAt: "2026-11-05T14:05:00.000Z",
    };
    const html = render(pageData({ query: { when: "done", type: "all", scope: "everyone", cursor: null }, rows: [late, anyTime] }));
    expect(dueCells(html)).toEqual(["Due: Nov 3, 10:00 AM · Done Yesterday, 10:00 AM", "Due: Today · Done Today, 9:05 AM"]);
  });

  it("offers Show more when there is another page", () => {
    expect(render(pageData({ nextCursor: "a2" }))).toContain("Show more");
    expect(render(pageData())).not.toContain("Show more");
  });

  it("explains an empty list and links the way forward", () => {
    const overdue = render(pageData({ rows: [] }));
    expect(overdue).toContain("Nothing overdue");
    expect(overdue).toContain("You are all caught up.");
    expect(overdue).toContain('href="/sales/activities?when=today"');
    expect(overdue).toContain("See what is due today");
    expect(overdue).not.toContain(">Subject</th>");

    const typed = render(pageData({ query: { when: "open", type: "MEETING", scope: "mine", cursor: null }, rows: [] }));
    expect(typed).toContain("No meeting activities here");
    expect(typed).toContain('href="/sales/activities?scope=mine"');
    expect(typed).toContain("Show all types");
  });
});
