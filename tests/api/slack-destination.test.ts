import { beforeEach, describe, expect, it, vi } from "vitest";

// Old audit #13: anyone could set their own Slack destination to any 20
// characters, such as a coworker's Slack member ID or a channel ID, so their
// notifications (which carry client details) went somewhere else. The
// self-service route now takes only a Slack member ID, and only the one that
// Slack says belongs to the person's own email. Slack is never called: fetch
// is stubbed and answers the way Slack's users.lookupByEmail does.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  db: { teamMember: { findUnique: vi.fn(), update: vi.fn() } },
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const { PATCH } = await import("@/app/api/me/slack-destination/route");

const MEMBER_ID = "member-1";
const MEMBER_EMAIL = "ann@example.com";
const ANN_SLACK_ID = "U0ANN12345";
const BOB_SLACK_ID = "U0BOB67890";
const EM_DASH = String.fromCharCode(0x2014);

function signedInAsStaff() {
  h.auth.mockResolvedValue({ user: { id: MEMBER_ID, name: "Ann", email: MEMBER_EMAIL } });
  h.db.teamMember.findUnique.mockResolvedValue({ id: MEMBER_ID, email: MEMBER_EMAIL });
}

function slackSaysEmailBelongsTo(slackUserId: string) {
  h.fetch.mockResolvedValue({ json: async () => ({ ok: true, user: { id: slackUserId } }) });
}

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/me/slack-destination", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function lookedUpEmails(): string[] {
  return h.fetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("email") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockReset();
  h.db.teamMember.findUnique.mockReset();
  h.db.teamMember.update.mockReset();
  h.fetch.mockReset();
  vi.stubGlobal("fetch", h.fetch);
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test-token");
});

describe("PATCH /api/me/slack-destination", () => {
  it("saves the person's own Slack member ID once Slack confirms it belongs to their email", async () => {
    signedInAsStaff();
    slackSaysEmailBelongsTo(ANN_SLACK_ID);

    const res = await patch({ slackUserId: ANN_SLACK_ID });

    expect(res.status).toBe(200);
    expect(h.db.teamMember.update).toHaveBeenCalledWith({ where: { id: MEMBER_ID }, data: { slackUserId: ANN_SLACK_ID } });
    expect(String(h.fetch.mock.calls[0][0])).toContain("https://slack.com/api/users.lookupByEmail?");
    expect(lookedUpEmails()).toEqual([MEMBER_EMAIL]);
  });

  it("checks the email on the person's own team record, not anything sent in the request", async () => {
    signedInAsStaff();
    slackSaysEmailBelongsTo(ANN_SLACK_ID);

    await patch({ slackUserId: ANN_SLACK_ID, email: "bob@example.com" });

    expect(h.db.teamMember.findUnique.mock.calls[0][0].where).toEqual({ id: MEMBER_ID });
    expect(lookedUpEmails()).toEqual([MEMBER_EMAIL]);
  });

  it("accepts an Enterprise Grid member ID (W prefix) that Slack confirms", async () => {
    signedInAsStaff();
    slackSaysEmailBelongsTo("W0ANN12345");

    const res = await patch({ slackUserId: "W0ANN12345" });

    expect(res.status).toBe(200);
    expect(h.db.teamMember.update).toHaveBeenCalledWith({ where: { id: MEMBER_ID }, data: { slackUserId: "W0ANN12345" } });
  });

  it("refuses a coworker's Slack member ID and tells the person to ask an admin", async () => {
    signedInAsStaff();
    slackSaysEmailBelongsTo(ANN_SLACK_ID);

    const res = await patch({ slackUserId: BOB_SLACK_ID });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/ask an admin/i);
    expect(body.error).not.toContain(EM_DASH);
    expect(h.db.teamMember.update).not.toHaveBeenCalled();
  });

  it.each([
    ["no Slack account uses their email", () => h.fetch.mockResolvedValue({ json: async () => ({ ok: false, error: "users_not_found" }) })],
    ["the Slack call fails", () => h.fetch.mockRejectedValue(new Error("network down"))],
    ["Slack answers without a user", () => h.fetch.mockResolvedValue({ json: async () => ({ ok: true }) })],
  ])("refuses when Slack cannot confirm the ID (%s)", async (_label, arrange) => {
    signedInAsStaff();
    arrange();

    const res = await patch({ slackUserId: ANN_SLACK_ID });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/ask an admin/i);
    expect(h.db.teamMember.update).not.toHaveBeenCalled();
  });

  it("refuses when the Slack connection is not set up, without calling Slack", async () => {
    signedInAsStaff();
    vi.stubEnv("SLACK_BOT_TOKEN", "");

    const res = await patch({ slackUserId: ANN_SLACK_ID });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/ask an admin/i);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.db.teamMember.update).not.toHaveBeenCalled();
  });

  it.each([
    ["a public channel ID", "C0123456789"],
    ["a private channel ID", "G0123456789"],
    ["a direct message ID", "D0123456789"],
    ["a lowercase ID", "u0ann12345"],
    ["an ID that is too short", "U0ANN12"],
    ["an ID that is too long", "U0ANN1234567890123456"],
    ["an ID with a space", "U0ANN 2345"],
    ["a pasted mention", "<@U0ANN12345>"],
    ["a channel name", "#general"],
  ])("refuses %s without asking Slack", async (_label, value) => {
    signedInAsStaff();
    slackSaysEmailBelongsTo(value);

    const res = await patch({ slackUserId: value });

    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toContain(EM_DASH);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.db.teamMember.update).not.toHaveBeenCalled();
  });

  it.each([null, ""])("clears the destination (%j) so notifications go back to matching by email", async (value) => {
    signedInAsStaff();

    const res = await patch({ slackUserId: value });

    expect(res.status).toBe(200);
    expect(h.db.teamMember.update).toHaveBeenCalledWith({ where: { id: MEMBER_ID }, data: { slackUserId: null } });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuses someone who is not signed in", async () => {
    h.auth.mockResolvedValue(null);

    const res = await patch({ slackUserId: ANN_SLACK_ID });

    expect(res.status).toBe(401);
    expect(h.db.teamMember.update).not.toHaveBeenCalled();
  });

  it("refuses a client-portal login (a session with no team record) without asking Slack", async () => {
    h.auth.mockResolvedValue({ user: { id: "client-user-1", name: "Portal User", isClientUser: true } });
    h.db.teamMember.findUnique.mockResolvedValue(null);
    slackSaysEmailBelongsTo(ANN_SLACK_ID);

    const res = await patch({ slackUserId: ANN_SLACK_ID });

    expect(res.status).toBe(401);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.db.teamMember.update).not.toHaveBeenCalled();
  });
});
