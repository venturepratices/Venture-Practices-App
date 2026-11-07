import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The admin Team dialog's Slack field (old audit #13 follow-up). A member can
// no longer point their notifications anywhere from Settings: only at their
// own Slack account, when its email matches theirs. The help text used to
// say they could change it themselves anytime.

vi.mock("@/lib/actions/team-members", () => ({ createTeamMemberAction: vi.fn(), updateTeamMemberAction: vi.fn() }));

const { SlackMemberIdField } = await import("@/components/team/team-member-form-dialog");

describe("Team dialog Slack help text", () => {
  const html = renderToStaticMarkup(createElement(SlackMemberIdField, { defaultValue: "U0123ABCD45" }));

  it("keeps the field and its stored value", () => {
    expect(html).toMatch(/<input(?=[^>]*name="slackUserId")(?=[^>]*value="U0123ABCD45")[^>]*>/);
  });

  it("no longer says members can change it themselves anytime", () => {
    expect(html).not.toMatch(/anytime/i);
  });

  it("says a member can set only their own member ID, when its email matches theirs", () => {
    expect(html).toMatch(/Settings, Notifications/);
    expect(html).toMatch(/own Slack member ID/i);
    expect(html).toMatch(/email matches theirs/i);
  });

  it("says anything else needs an admin", () => {
    expect(html).toMatch(/needs an admin/i);
  });

  it("uses no em dashes", () => {
    expect(html).not.toContain(String.fromCharCode(0x2014));
  });
});
