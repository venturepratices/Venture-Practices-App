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

const REAL_COPY_DONE = { status: "DONE" as const, finishedAt: "2026-11-12T15:40:00.000Z" };

function makeStatus(overrides: Partial<ImportStatus> = {}): ImportStatus {
  return {
    token: { set: true, last4: "9f3a" },
    locked: false,
    lockedAt: null,
    run: null,
    realCopy: null,
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

const USERS: ImportStatus["users"] = [
  { pipedriveUserId: 1, name: "Ben P", email: "ben@example.com", memberId: "m1", memberName: "Ben Example", auto: true },
  { pipedriveUserId: 2, name: "Old Rep", email: "old@example.com", memberId: null, memberName: null, auto: false },
];

describe("ImportView states", () => {
  it("token not set: the three Vercel steps in order and no start buttons", () => {
    const html = render(makeStatus({ token: { set: false, last4: null } }));
    expect(html).toContain("Add the Pipedrive key first");
    expect(html).toContain("Environment Variables");
    expect(html).toContain("PIPEDRIVE_API_TOKEN");
    expect(html).toContain("Production");
    expect(html).toContain("Redeploy");
    expect(html).toContain("never shown here");
    const steps = /<ol[^>]*>([\s\S]*?)<\/ol>/.exec(html);
    expect(steps).not.toBeNull();
    expect((steps![1].match(/<li/g) ?? []).length).toBe(3);
    for (const label of START_BUTTONS) expect(html).not.toContain(`>${label}</button>`);
  });

  it("ready: both buttons, the last 4 of the token, the boss sentence, files in the intro", () => {
    const html = render(makeStatus());
    expect(html).toContain("Practice run (saves nothing)");
    expect(html).toContain("Copy for real");
    expect(html).toContain("ending in 9f3a");
    expect(html).toContain("Until you switch off Pipedrive, Pipedrive is the boss. Copying again replaces edits made here to copied records.");
    expect(html).toContain("notes and files into the app");
    expect(html).toContain("Not copied");
    expect(html).toContain("Smart Docs");
    expect(html).toContain("over 4 MB");
  });

  it("ready before any real copy: no final box", () => {
    const html = render(makeStatus());
    expect(html).not.toContain("Final copy and lock");
    const afterPractice = render(makeStatus({ run: makeRun({ mode: "DRY_RUN" }) }));
    expect(afterPractice).not.toContain("Final copy and lock");
  });

  it("after a finished real copy: the final box is its own section, says what it does, and starts disabled", () => {
    const html = render(makeStatus({ run: makeRun(), realCopy: REAL_COPY_DONE }));
    expect(html).toContain("Final copy and lock");
    expect(html).toContain("ends copying for good");
    expect(html).toContain("replacing edits made here to copied records");
    expect(html).toContain("after you have checked a real copy");
    expect(html).toContain("Type LOCK to confirm");
    expect(html).toContain("Type LOCK in capitals.");
    expect(html).toContain('autoCapitalize="characters"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Final copy and lock<\/button>/);
  });

  it("running after the page was left: the step in plain words and Keep going", () => {
    const html = render(makeStatus({ run: makeRun({ status: "RUNNING", phase: "deals", finishedAt: null }) }));
    expect(html).toContain("The real copy is paused");
    expect(html).toContain("Copying deals");
    expect(html).toContain("Step 5 of 9");
    expect(html).toContain("Keep going");
    expect(html).not.toContain("tab was closed");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain(">Copy for real</button>");
    expect(html).not.toContain(">Final copy and lock</button>");
  });

  it("failed: the plain message, plain words about what is kept, and Start again", () => {
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
    expect(html).toContain("The next copy only adds or fixes what differs.");
    expect(html).not.toContain("carries on matching");
    expect(html).not.toContain("It did not lock.");
    expect(html).toContain("Start again");
    expect(html).not.toContain(">Copy for real</button>");
  });

  it("a failed final copy says it did not lock", () => {
    const html = render(makeStatus({ run: makeRun({ status: "FAILED", isFinal: true, phase: "notes" }) }));
    expect(html).toContain("It did not lock.");
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
        run: makeRun({ issues, counts: { "deals.created": 7, issuesDropped: 1200 } }),
        realCopy: REAL_COPY_DONE,
        check: {
          at: "2026-11-12T15:44:00.000Z",
          report: {
            rows: [
              { label: "Deals", entity: "deals", pipedrive: 1655, app: 1600, skipped: 0, ok: false },
              { label: "People", entity: "persons", pipedrive: 1284, app: 1280, skipped: 4, ok: true },
            ],
            spot: [{ title: "Acme Dental mailer", valueCents: 450000, stage: "Proposal Sent", owner: "Ben Example", status: "OPEN", pipedriveId: 1204 }],
          },
        },
        users: USERS,
      }),
    );
    // The check table, its time, and the 1 percent rule.
    expect(html).toContain(">Check the copy</button>");
    expect(html).toContain("In Pipedrive");
    expect(html).toContain("55 short");
    expect(html).toContain("Matches");
    expect(html).toContain("1,284");
    expect(html).toContain("within 1 percent counts as a match");
    // The spot checks.
    expect(html).toContain("Compare these deals in Pipedrive");
    expect(html).toContain("Acme Dental mailer");
    expect(html).toContain("$4,500,");
    expect(html).toContain("1204");
    // The owners: unmatched marker, and changes apply on the next copy.
    expect(html).toContain("Old Rep");
    expect(html).toContain("Not matched");
    expect(html).toContain('aria-label="Team member for Old Rep"');
    expect(html).toContain("matched by email");
    expect(html).toContain("A change applies the next time you copy.");
    // Issues: grouped, 50 shown, the rest counted, numbers formatted.
    expect(html).toContain("Deals: 3 times, example ids 12, 40, 77: Problem number 1.");
    expect(html).toContain("Problem number 50.");
    expect(html).not.toContain("Problem number 51.");
    expect(html).toContain("And 3 more kinds not shown.");
    expect(html).toContain("1,200 more were not kept");
    // Running again is still offered.
    expect(html).toContain(">Copy for real</button>");
  });

  it("singular issue counts read right", () => {
    const issues = Array.from({ length: 51 }, (_, i) => ({ phase: "deals" as const, message: `P${i}.`, count: 1, sampleIds: [i] }));
    const html = render(makeStatus({ run: makeRun({ issues, counts: { issuesDropped: 1 } }) }));
    expect(html).toContain("And 1 more kind not shown.");
    expect(html).toContain("1 more was not kept");
  });

  it("done after a practice run with no real copy: no check button, says the check needs a real copy", () => {
    const html = render(makeStatus({ run: makeRun({ mode: "DRY_RUN" }) }));
    expect(html).toContain("The practice run finished");
    expect(html).toContain("after a real copy");
    expect(html).not.toContain(">Check the copy</button>");
  });

  it("a practice run after a finished real copy keeps the check button", () => {
    const html = render(makeStatus({ run: makeRun({ mode: "DRY_RUN" }), realCopy: REAL_COPY_DONE }));
    expect(html).toContain(">Check the copy</button>");
  });

  it("locked: no start buttons, the lock date, disabled pickers, and the final copy can still be checked", () => {
    const html = render(
      makeStatus({
        locked: true,
        lockedAt: "2026-12-01T14:12:00.000Z",
        run: makeRun({ isFinal: true }),
        realCopy: { status: "DONE", finishedAt: "2026-12-01T14:12:00.000Z" },
        users: USERS,
      }),
    );
    expect(html).toContain("Copying is locked");
    expect(html).toContain("Dec 1, 2026");
    for (const label of START_BUTTONS) expect(html).not.toContain(`>${label}</button>`);
    expect(html).not.toContain("Type LOCK to confirm");
    expect(html).toMatch(/<select[^>]*aria-label="Team member for Old Rep"[^>]*disabled|<select[^>]*disabled[^>]*aria-label="Team member for Old Rep"/);
    expect(html).toContain("The final copy has not been checked yet.");
    expect(html).toContain(">Check the copy</button>");
  });
});

describe("RunProgress", () => {
  const base = { counts: {}, title: "The real copy", onKeepGoing: () => {}, busy: false, finishing: false };

  it("paused: the slow-down sentence", () => {
    const html = clean(renderToString(createElement(RunProgress, { ...base, phase: "activities", paused: true, active: true })));
    expect(html).toContain("Pipedrive asked us to slow down. Continuing in a minute.");
    expect(html).toContain("Copying activities");
    expect(html).toContain("The real copy is running");
    expect(html).not.toContain("Keep going");
  });

  it("active: counts so far, stay on this page, and no Keep going", () => {
    const html = clean(
      renderToString(
        createElement(RunProgress, { ...base, phase: "deals", counts: { "organizations.created": 412, "deals.created": 300 }, paused: false, active: true }),
      ),
    );
    expect(html).toContain("Copying deals");
    expect(html).toContain("412");
    expect(html).toContain("Stay on this page");
    expect(html).not.toContain("Keep going");
  });

  it("shows a Files line while files are being copied, with everything looked at so far", () => {
    const counts = { "files.seen": 1330, "files.created": 1284, "files.unchanged": 37, "files.skipped": 9 };
    const html = clean(renderToString(createElement(RunProgress, { ...base, phase: "files", counts, paused: false, active: true })));
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toMatch(/Files 1,330 so far/);
    expect(html).toContain("Copying files");
  });

  it("finishing: says so instead of a step", () => {
    const html = clean(renderToString(createElement(RunProgress, { ...base, phase: "done", paused: false, active: true, finishing: true })));
    expect(html).toContain("Finishing up");
  });
});

describe("a finished copy with files", () => {
  it("shows a Files row in the counts table: new, changed, same, left out", () => {
    const counts = { "deals.created": 7, "files.seen": 1330, "files.created": 1284, "files.unchanged": 37, "files.skipped": 9 };
    const html = render(makeStatus({ run: makeRun({ counts }), realCopy: REAL_COPY_DONE }));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toMatch(/Deals 7 0 0 0/);
    expect(text).toMatch(/Files 1,284 0 37 9/);
  });
});

describe("pure helpers", () => {
  it("the final button needs exactly LOCK", () => {
    expect(model.finalEnabled("")).toBe(false);
    expect(model.finalEnabled("lock")).toBe(false);
    expect(model.finalEnabled("Lock")).toBe(false);
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
    const many = model.issueLines([{ phase: "notes", message: "Long.", count: 1500, sampleIds: [1] }]);
    expect(many.lines).toEqual(["Notes: 1,500 times, example id 1: Long."]);
  });

  it("counts files like every other kind, and leaves them out until a file has been looked at", () => {
    expect(model.countRows({ "deals.created": 2 }).map((row) => row.label)).toEqual(["Deals"]);
    expect(model.countRows({ "deals.created": 2, "files.created": 5, "files.unchanged": 3, "files.skipped": 1 })).toEqual([
      { label: "Deals", created: 2, updated: 0, unchanged: 0, skipped: 0 },
      { label: "Files", created: 5, updated: 0, unchanged: 3, skipped: 1 },
    ]);
  });

  it("lists the storage line first, so it is never off the visible lines", () => {
    const groups = [
      { phase: "persons" as const, message: "No name.", count: 1, sampleIds: [9] },
      { phase: "files" as const, message: 'File "A.pdf" on "Oak deal": Too big to copy (over 4 MB). Attach it by hand.', count: 1, sampleIds: [1] },
      { phase: "files" as const, message: "File storage is not set up, so no more files were copied.", count: 1, sampleIds: [2] },
    ];
    const shown = model.issueLines(groups, 2);
    expect(shown.lines).toEqual([
      "Files: 1 time, example id 2: File storage is not set up, so no more files were copied.",
      "People: 1 time, example id 9: No name.",
    ]);
    expect(shown.rest).toBe(1);
    // Nothing else is reordered, and the same line from another step is not moved.
    const other = [
      { phase: "deals" as const, message: "File storage is not set up, so no more files were copied.", count: 1, sampleIds: [] },
      { phase: "persons" as const, message: "No name.", count: 1, sampleIds: [] },
    ];
    expect(model.issueLines(other).lines.map((line) => line.split(":")[0])).toEqual(["Deals", "People"]);
  });

  it("says the first files are listed and the rest are counted", () => {
    expect(model.NOT_COPIED_FILES).toBe(
      "Files over 4 MB, or of a type the app does not take, are not copied. The first ones are listed under Things to look at; the rest are counted.",
    );
  });

  it("says how a check row came out, with its direction", () => {
    expect(model.checkResult({ label: "Deals", entity: "deals", pipedrive: 1655, app: 1600, skipped: 0, ok: false })).toBe("55 short");
    expect(model.checkResult({ label: "Deals", entity: "deals", pipedrive: 100, app: 1103, skipped: 0, ok: false })).toBe("1,003 extra");
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

  it("names each kind of run", () => {
    expect(model.runName({ mode: "DRY_RUN", isFinal: false })).toBe("The practice run");
    expect(model.runName({ mode: "LIVE", isFinal: false })).toBe("The real copy");
    expect(model.runName({ mode: "LIVE", isFinal: true })).toBe("The final copy");
  });
});
