import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { NO_CAMPAIGN, draftWithClient, saveFailureMessage } from "@/components/tasks/task-draft";

// The task panel's Save (review of the access checks on task routes). The
// PATCH route now refuses a campaign that belongs to a different client than
// the task, so changing the Client and keeping (or picking) a campaign from
// the old client's list got a 400 that nothing showed. Changing the Client
// now clears a campaign from the old client, the campaign list follows the
// chosen client, and a refused save shows the server's reason.

const SAVED = { clientId: "client-a", campaignId: "campaign-a1", campaignStage: "PRINTING" };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("draftWithClient", () => {
  it("clears a campaign from the old client when the Client changes", () => {
    const draft = { ...SAVED, title: "Mail drop" };

    expect(draftWithClient(draft, "client-b", SAVED)).toEqual({
      clientId: "client-b",
      campaignId: NO_CAMPAIGN,
      campaignStage: "PRINTING",
      title: "Mail drop",
    });
  });

  it("clears it when the task becomes internal too", () => {
    expect(draftWithClient(SAVED, "__none__", SAVED).campaignId).toBe(NO_CAMPAIGN);
  });

  it("puts the saved campaign and stage back when the Client is changed back", () => {
    const movedAway = draftWithClient(SAVED, "client-b", SAVED);

    expect(draftWithClient(movedAway, "client-a", SAVED)).toEqual(SAVED);
  });

  it("leaves a task with no campaign without one", () => {
    const none = { clientId: "client-a", campaignId: NO_CAMPAIGN, campaignStage: "PLANNING" };

    expect(draftWithClient(none, "client-b", none).campaignId).toBe(NO_CAMPAIGN);
  });

  it("changes nothing else and does not change the draft it was given", () => {
    const draft = { ...SAVED, title: "Mail drop", assigneeIds: ["m-1"] };
    const before = structuredClone(draft);

    const next = draftWithClient(draft, "client-b", SAVED);

    expect(next.title).toBe("Mail drop");
    expect(next.assigneeIds).toEqual(["m-1"]);
    expect(draft).toEqual(before);
  });
});

describe("saveFailureMessage", () => {
  it("shows the reason the server gave", async () => {
    const reason = "That campaign belongs to a different client than this task";

    expect(await saveFailureMessage(jsonResponse(400, { error: reason }))).toBe(reason);
  });

  it("falls back to a plain message when the server gave no reason", async () => {
    const fallback = "Couldn't save your changes. Try again.";

    expect(await saveFailureMessage(new Response("Internal Server Error", { status: 500 }))).toBe(fallback);
    expect(await saveFailureMessage(jsonResponse(500, {}))).toBe(fallback);
    expect(await saveFailureMessage(jsonResponse(400, { error: "" }))).toBe(fallback);
  });

  it("uses no em dashes", async () => {
    expect(await saveFailureMessage(jsonResponse(500, {}))).not.toContain(String.fromCharCode(0x2014));
  });
});

// There is no browser test setup, so these read the panel's source to check
// the helpers above are what the panel actually uses.
describe("task panel wiring", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/tasks/task-detail-panel.tsx"), "utf8");

  function body(signature: string): string {
    const start = source.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf("\n  }\n", start));
  }

  it("shows the server's reason when Save is refused, and when the request fails", () => {
    const save = body("async function save()");
    expect(save).toMatch(/if \(!response\.ok\) \{\s*showSaveError\(await saveFailureMessage\(response\)\);/);
    expect(save).toContain("catch");
    expect(source).toMatch(/\{saveError \? \(\s*<p role="alert"[^>]*>\s*\{saveError\}/);
  });

  it("clears a campaign from the old client when the Client select changes", () => {
    const start = source.indexOf("<Label>Client</Label>");
    expect(start).toBeGreaterThan(-1);
    const select = source.slice(start, source.indexOf("</Select>", start));
    expect(select).toContain("draftWithClient(prev, value, draftFromTask(task))");
  });

  it("lists the campaigns of the client chosen in the panel, not only the saved one", () => {
    const start = source.indexOf("fetch(`/api/campaigns?clientId=");
    expect(start).toBeGreaterThan(-1);
    const effect = source.slice(source.lastIndexOf("useEffect(", start), source.indexOf("}, [", start));
    expect(effect).toContain("draftClientId");
    expect(source).toContain("}, [draftClientId]);");
  });
});
