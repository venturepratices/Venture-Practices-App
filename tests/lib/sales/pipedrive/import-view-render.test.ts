import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ImportRunView, ImportStatus } from "@/lib/sales/pipedrive/import-view-model";

// A server render of the "Copy from Pipedrive" screen with fixed props, one per
// state, plus the small pure helpers that decide what it shows. Node has no
// browser, so nothing is clicked here; the live click-through covers that.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/sales/settings/import",
  useSearchParams: () => new URLSearchParams(""),
}));

const model = await import("@/lib/sales/pipedrive/import-view-model");
const { ImportView, RunProgress } = await import("@/components/sales/import-view");

const clean = (html: string) => html.replaceAll("<!-- -->", "");

function makeRun(overrides: Partial<ImportRunView> = {}): ImportRunView {
  return {
    id: "run1",
    mode: "LIVE",
    isFinal: false,
    status: "DONE",
    phase: "done",
    counts: { "deals.seen": 10, "deals.created": 7, "deals.updated": 2, "deals.unchanged": 1, "deals.skipped": 0 },
    issues: [],
    startedAt: "2026-11-12T15:00:00.000Z",
    finishedAt: "2026-11-12T15:40:00.000Z",
    ...overrides,
  };
}

function makeStatus(overrides: Partial<ImportStatus> = {}): ImportStatus {
  return {
    token: { set: true, last4: "9f3a" },
    locked: false,
    lockedAt: null,
    run: null,
    check: null,
    users: [],
    members: [
      { id: "m1", name: "Ben Example" },
      { id: "m2", name: "Robert O." },
    ],
    ...overrides,
  };
}

const render = (status: ImportStatus) => clean(renderToString(createElement(ImportView, { initial: status })));

const START_BUTTONS = ["Practice run (saves nothing)", "Copy for real", "Final copy and lock"];

describe("ImportView states", () => {
  it("token not set: the three Vercel steps and no start buttons", () => {
    const html = render(makeStatus({ token: { set: false, last4: null } }));
    expect(html).toContain("Add the Pipedrive key first");
    expect(html).toContain("Environment Variables");
    expect(html).toContain("PIPEDRIVE_API_TOKEN");
    expect(html).toContain("Production");
    expect(html).toContain("Redeploy");
    expect(html).toContain("never shown here");
    expect((html.match(/<li/g) ?? []).length).toBeGreaterThanOrEqual(3);
    for (const label of START_BUTTONS) expect(html).not.toContain(`>${label}</button>`);
  });

  it("ready: both buttons, the last 4 of the token and the Pipedrive is the boss sentence", () => {
    const html = render(makeStatus());
    expect(html).toContain("Practice run (saves nothing)");
    expect(html).toContain("Copy for real");
    expect(html).toContain("ending in 9f3a");
    expect(html).toContain("Until you switch off Pipedrive, Pipedrive is the boss. Copying again replaces edits made here to copied records.");
    expect(html).toContain("Not copied");
    expect(html).toContain("Smart Docs");
    expect(html).toContain("over 4 MB");
  });

  it("ready: the final box is its own section, says it ends copying for good, and starts disabled", () => {
    const html = render(makeStatus());
    expect(html).toContain("Final copy and lock");
    expect(html).toContain("ends copying for good");
    expect(html).toContain("Type LOCK to confirm");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Final copy and lock<\/button>/);
  });

  it("running after the tab was closed: the step in plain words and Keep going", () => {
    const html = render(makeStatus({ run: makeRun({ status: "RUNNING", phase: "deals", finishedAt: null }) }));
    expect(html).toContain("Copying deals");
    expect(html).toContain("Step 5 of 9");
    expect(html).toContain("Keep going");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain(">Copy for real</button>");
    expect(html).not.toContain(">Final copy and lock</button>");
  });

  it("failed: the plain message and Start again", () => {
    const html = render(
      makeStatus({
        run: makeRun({
          status: "FAILED",
          phase: "persons",
          issues: [{ phase: "persons", message: "The copy stopped: Pipedrive refused the token.", count: 1, sampleIds: [] }],
        }),
      }),
    );
    expect(html).toContain("The copy stopped: Pipedrive refused the token.");
    expect(html).toContain("Start again");
    expect(html).not.toContain(">Copy for real</button>");
  });

  it("done: check table, spot checks, owners with an unmatched marker, grouped issues and the count of the rest", () => {
    const issues = Array.from({ length: 53 }, (_, i) => ({
      phase: "deals" as const,
      message: `Problem number ${i + 1}.`,
      count: 3,
      sampleIds: [12, 40, 77],
    }));
    const html = render(
      makeStatus({
        run: makeRun({ issues }),
        check: {
          at: "2026-11-12T15:44:00.000Z",
          report: {
            rows: [
              { label: "Deals", entity: "deals", pipedrive: 655, app: 650, skipped: 0, ok: false },
              { label: "People", entity: "persons", pipedrive: 1284, app: 1280, skipped: 4, ok: true },
            ],
            spot: [{ title: "Acme Dental mailer", valueCents: 450000, stage: "Proposal Sent", owner: "Ben Example", status: "OPEN", pipedriveId: 1204 }],
          },
        },
        users: [
          { pipedriveUserId: 1, name: "Ben P", email: "ben@example.com", memberId: "m1", memberName: "Ben Example", auto: true },
          { pipedriveUserId: 2, name: "Old Rep", email: "old@example.com", memberId: null, memberName: null, auto: false },
        ],
      }),
    );
    // The check table and its time.
    expect(html).toContain("Check the copy");
    expect(html).toContain("In Pipedrive");
    expect(html).toContain("Off by 5");
    expect(html).toContain("Matches");
    expect(html).toContain("1,284");
    // The spot checks.
    expect(html).toContain("Compare these deals in Pipedrive");
    expect(html).toContain("Acme Dental mailer");
    expect(html).toContain("$4,500,");
    expect(html).toContain("1204");
    // The owners.
    expect(html).toContain("Old Rep");
    expect(html).toContain("Not matched");
    expect(html).toContain('aria-label="Team member for Old Rep"');
    expect(html).toContain("matched by email");
    // Issues: grouped, 50 shown, the rest counted.
    expect(html).toContain("Deals: 3 times, example ids 12, 40, 77: Problem number 1.");
    expect(html).toContain("Problem number 50.");
    expect(html).not.toContain("Problem number 51.");
    expect(html).toContain("And 3 more kinds not shown.");
    // Running again is still offered.
    expect(html).toContain(">Copy for real</button>");
  });

  it("done after a practice run: no check button, says the check needs a real copy", () => {
    const html = render(makeStatus({ run: makeRun({ mode: "DRY_RUN" }) }));
    expect(html).toContain("Practice run finished");
    expect(html).toContain("after a real copy");
    expect(html).not.toContain(">Check the copy</button>");
  });

  it("locked: no start buttons, the lock date and the read-only report", () => {
    const html = render(
      makeStatus({
        locked: true,
        lockedAt: "2026-12-01T14:12:00.000Z",
        run: makeRun({ isFinal: true }),
      }),
    );
    expect(html).toContain("Copying is locked");
    expect(html).toContain("Dec 1, 2026");
    for (const label of START_BUTTONS) expect(html).not.toContain(`>${label}</button>`);
    expect(html).not.toContain("Type LOCK to confirm");
  });
});

describe("RunProgress", () => {
  it("paused: the slow-down sentence", () => {
    const html = clean(
      renderToString(createElement(RunProgress, { phase: "activities", counts: {}, paused: true, active: true, title: "Copy for real", onKeepGoing: () => {}, busy: false })),
    );
    expect(html).toContain("Pipedrive asked us to slow down. Continuing in a minute.");
    expect(html).toContain("Copying activities");
    expect(html).not.toContain("Keep going");
  });

  it("active: counts so far and no Keep going", () => {
    const html = clean(
      renderToString(
        createElement(RunProgress, {
          phase: "deals",
          counts: { "organizations.created": 412, "deals.created": 300 },
          paused: false,
          active: true,
          title: "Copy for real",
          onKeepGoing: () => {},
          busy: false,
        }),
      ),
    );
    expect(html).toContain("Copying deals");
    expect(html).toContain("412");
    expect(html).not.toContain("Keep going");
  });
});

describe("pure helpers", () => {
  it("the final button needs exactly LOCK", () => {
    expect(model.finalEnabled("")).toBe(false);
    expect(model.finalEnabled("lock")).toBe(false);
    expect(model.finalEnabled("LOCKED")).toBe(false);
    expect(model.finalEnabled("LOCK")).toBe(true);
    expect(model.finalEnabled(" LOCK ")).toBe(true);
  });

  it("picks the screen state", () => {
    expect(model.screenState(makeStatus({ token: { set: false, last4: null } }))).toBe("no-token");
    expect(model.screenState(makeStatus({ locked: true, run: makeRun() }))).toBe("locked");
    expect(model.screenState(makeStatus({ run: makeRun({ status: "RUNNING" }) }))).toBe("running");
    expect(model.screenState(makeStatus({ run: makeRun({ status: "FAILED" }) }))).toBe("failed");
    expect(model.screenState(makeStatus({ run: makeRun() }))).toBe("done");
    expect(model.screenState(makeStatus())).toBe("ready");
    // A locked copy stays locked even with no token left in Vercel.
    expect(model.screenState(makeStatus({ token: { set: false, last4: null }, locked: true }))).toBe("locked");
  });

  it("names every step in plain words", () => {
    expect(model.stepLabel("users")).toBe("Reading Pipedrive users");
    expect(model.stepLabel("persons")).toBe("Copying people");
    expect(model.stepLabel("deals")).toBe("Copying deals");
    expect(model.stepLabel("done")).toBe("Finished");
    expect(model.stepLabel("something-else")).toBe("Working");
    expect(model.stepPosition("users")).toEqual({ step: 1, total: 9 });
    expect(model.stepPosition("files")).toEqual({ step: 9, total: 9 });
  });

  it("groups issue lines and counts the rest", () => {
    const one = model.issueLines([{ phase: "persons", message: "No name.", count: 1, sampleIds: [9] }]);
    expect(one).toEqual({ lines: ["People: 1 time, example id 9: No name."], rest: 0 });
    const none = model.issueLines([{ phase: "structure", message: "A field was skipped.", count: 2, sampleIds: [] }]);
    expect(none.lines).toEqual(["Pipelines, stages and fields: 2 times: A field was skipped."]);
  });

  it("says how a check row came out", () => {
    expect(model.checkResult({ label: "Deals", entity: "deals", pipedrive: 655, app: 650, skipped: 0, ok: false })).toBe("Off by 5");
    expect(model.checkResult({ label: "Deals", entity: "deals", pipedrive: 5, app: 5, skipped: 0, ok: true })).toBe("Matches");
  });

  it("finds the failure message", () => {
    expect(model.failureMessage(makeRun({ status: "FAILED", issues: [] }))).toBe("The copy stopped before it finished.");
    expect(
      model.failureMessage(
        makeRun({
          status: "FAILED",
          issues: [
            { phase: "deals", message: "Some row issue.", count: 1, sampleIds: [1] },
            { phase: "deals", message: "The copy stopped: Pipedrive is down.", count: 1, sampleIds: [] },
          ],
        }),
      ),
    ).toBe("The copy stopped: Pipedrive is down.");
  });
});
