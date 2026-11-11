import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The "Where on Slack" box on the notification settings page (old audit
// #13). The route now refuses channel IDs and other people's member IDs with
// a reason that says to ask an admin, so the box has to show that reason
// instead of a generic "try again", and must no longer offer channel IDs.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { NotificationPreferencesForm, saveErrorMessage } = await import("@/components/settings/notification-preferences-form");

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("saveErrorMessage", () => {
  it("shows the reason the server gave, such as asking an admin", async () => {
    const reason = "We couldn't confirm that Slack member ID is yours. Ask an admin to set it for you.";

    expect(await saveErrorMessage(jsonResponse(403, { error: reason }))).toBe(reason);
  });

  it("falls back to a generic message when the server gave no reason", async () => {
    expect(await saveErrorMessage(new Response("Internal Server Error", { status: 500 }))).toBe("Failed to save. Try again.");
    expect(await saveErrorMessage(jsonResponse(500, {}))).toBe("Failed to save. Try again.");
  });

  // There is no browser test setup, so this reads the form's source: the
  // Update button's refusal has to go through saveErrorMessage, or the
  // "ask an admin" reason never reaches the person.
  it("is what the Update button shows when the Slack ID is refused", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/settings/notification-preferences-form.tsx"), "utf8");
    const start = source.indexOf('fetch("/api/me/slack-destination"');
    expect(start).toBeGreaterThan(-1);
    const refusal = source.slice(start, source.indexOf("return;", start));

    expect(refusal).toContain("setDestinationSaveError(await saveErrorMessage(res))");
  });
});

describe("Where on Slack help text", () => {
  const html = renderToStaticMarkup(
    createElement(NotificationPreferencesForm, {
      initial: { slackEnabled: true, mutedCategories: [], ambientDigest: true },
      slackDestinationInitial: null,
    })
  );

  it("no longer offers sending notifications to a channel", () => {
    expect(html).not.toMatch(/channel ID/i);
    expect(html).not.toMatch(/channel you pick/i);
  });

  it("says only your own Slack account works here and to ask an admin for anything else", () => {
    expect(html).toMatch(/Slack account with your email/i);
    expect(html).toMatch(/ask an admin/i);
  });

  it("uses no em dashes in the Slack box", () => {
    const start = html.indexOf("Where on Slack");
    const end = html.indexOf("What you");
    expect(start).toBeGreaterThan(-1);
    expect(html.slice(start, end)).not.toContain(String.fromCharCode(0x2014));
  });
});
