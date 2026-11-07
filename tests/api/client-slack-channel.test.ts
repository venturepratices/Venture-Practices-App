import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Old audit #14: anyone allowed to edit (or create) clients could point a
// client's Slack channel at any channel, such as another client's or the
// team's general one. That client's team posts then land there, and the
// channel sync invites (or removes) people to match that client's access.
// Now only an admin can set or change it, and only to something shaped like
// a Slack channel ID that no other client uses. Everything else an editor
// can change is untouched, and the automatic channel for a new client still
// gets made. The real permission helpers and the real Slack helper run over
// a mocked database; fetch is stubbed, so Slack is never called.

// react's cache() only works inside React server rendering; outside of it,
// treat it as a plain pass-through so permissions are re-read every test.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    auth: fn(),
    db: {
      teamMember: { findUnique: fn(), findMany: fn(), update: fn() },
      client: { create: fn(), update: fn(), findUnique: fn(), findFirst: fn() },
    },
    logActivity: fn(),
    fetch: fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/activity-log", () => ({ logActivity: h.logActivity }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const { CAPABILITIES } = await import("@/lib/permission-catalog");
const { createClientAction, updateClientAction } = await import("@/lib/actions/clients");
const clientChannelRoute = await import("@/app/api/admin/notifications/client-channel/route");

const MEMBER_ID = "member-1";
const CLIENT_ID = "client-a";
const CURRENT_CHANNEL = "C0SMILE1234";
const OTHER_CHANNEL = "C0OTHER5678";
const INTERNAL_CHANNEL = "C0INTERNAL1";
const NOTHING_SAVED = { error: null };

function signIn(options: { isAdmin?: boolean; caps?: string[]; clients?: string[] } = {}) {
  const caps = Object.fromEntries(CAPABILITIES.map((cap) => [cap, (options.caps ?? []).includes(cap)]));
  h.auth.mockResolvedValue({ user: { id: MEMBER_ID, name: "Staff Member" } });
  h.db.teamMember.findUnique.mockResolvedValue({
    id: MEMBER_ID,
    isAdmin: options.isAdmin ?? false,
    allClientsAccess: false,
    clientAccess: (options.clients ?? [CLIENT_ID]).map((clientId) => ({ clientId })),
    ...caps,
  });
}

const signInAsEditor = () => signIn({ caps: ["canEditClients", "canCreateClients"] });
const signInAsAdmin = () => signIn({ isAdmin: true });

function storedClient(slackChannelId: string | null = CURRENT_CHANNEL) {
  return {
    id: CLIENT_ID,
    name: "Smile Dental",
    status: "ACTIVE",
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    secondaryContactName: null,
    secondaryContactEmail: null,
    secondaryContactPhone: null,
    website: null,
    address: null,
    about: null,
    source: null,
    slackChannelId,
  };
}

function clientForm(fields: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = { name: "Smile Dental", status: "ACTIVE", ...fields };
  const form = new FormData();
  for (const [key, value] of Object.entries(all)) if (value !== undefined) form.set(key, value);
  return form;
}

function update(fields: Record<string, string | undefined>) {
  return updateClientAction(CLIENT_ID, NOTHING_SAVED, clientForm(fields));
}

function create(fields: Record<string, string | undefined>) {
  return createClientAction(NOTHING_SAVED, clientForm(fields));
}

function savedChannel() {
  const data = h.db.client.update.mock.calls[0][0].data;
  return "slackChannelId" in data ? data.slackChannelId : "(unchanged)";
}

function slackCreatesChannel(channelId: string) {
  h.fetch.mockImplementation(async (url: string) => ({
    json: async () => (String(url).endsWith("/conversations.create") ? { ok: true, channel: { id: channelId } } : { ok: true }),
  }));
}

function slackMethodsCalled(): string[] {
  return h.fetch.mock.calls.map(([url]) => String(url).replace("https://slack.com/api/", "").split("?")[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockReset();
  for (const model of Object.values(h.db)) {
    for (const method of Object.values(model)) method.mockReset();
  }
  h.fetch.mockReset();
  vi.stubGlobal("fetch", h.fetch);
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test-token");
  vi.stubEnv("SLACK_INTERNAL_CHANNEL_ID", INTERNAL_CHANNEL);
  h.db.teamMember.findMany.mockResolvedValue([]);
  h.db.client.findUnique.mockResolvedValue(storedClient());
  h.db.client.findFirst.mockResolvedValue(null);
  h.db.client.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...storedClient(), ...data }));
  h.db.client.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...storedClient(null), ...data }));
});

describe("editing a client (updateClientAction)", () => {
  it("still lets an editor who is not an admin save the client's other details", async () => {
    signInAsEditor();

    const result = await update({ contactName: "Dr. Smile", website: "https://smile.example", slackChannelId: CURRENT_CHANNEL });

    expect(result).toEqual({ error: null });
    expect(h.db.client.update.mock.calls[0][0].where).toEqual({ id: CLIENT_ID });
    expect(h.db.client.update.mock.calls[0][0].data).toMatchObject({ contactName: "Dr. Smile", website: "https://smile.example" });
    expect(["(unchanged)", CURRENT_CHANNEL]).toContain(savedChannel());
  });

  it("still lets an editor save a client with no Slack channel yet, leaving the box blank", async () => {
    signInAsEditor();
    h.db.client.findUnique.mockResolvedValue(storedClient(null));

    const result = await update({ about: "New practice", slackChannelId: "" });

    expect(result).toEqual({ error: null });
    expect(["(unchanged)", null]).toContain(savedChannel());
  });

  it("still lets an editor save a client whose stored channel predates the stricter check", async () => {
    signInAsEditor();
    h.db.client.findUnique.mockResolvedValue(storedClient("c0legacy"));

    const result = await update({ about: "Updated", slackChannelId: "c0legacy" });

    expect(result).toEqual({ error: null });
    expect(["(unchanged)", "c0legacy"]).toContain(savedChannel());
  });

  it.each([
    ["another channel", OTHER_CHANNEL],
    ["the team's general channel", INTERNAL_CHANNEL],
    ["nothing (clearing it)", ""],
  ])("refuses an editor who is not an admin pointing the client at %s", async (_label, value) => {
    signInAsEditor();

    const result = await update({ contactName: "Dr. Smile", slackChannelId: value });

    expect(result.error).toMatch(/only an admin/i);
    expect(result.error).not.toContain(String.fromCharCode(0x2014));
    expect(h.db.client.update).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuses an editor who is not an admin sending the form without the Slack field", async () => {
    signInAsEditor();

    const result = await update({ contactName: "Dr. Smile", slackChannelId: undefined });

    expect(result.error).toMatch(/only an admin/i);
    expect(h.db.client.update).not.toHaveBeenCalled();
  });

  it.each([OTHER_CHANNEL, "G0PRIVATE12"])("lets an admin point the client at another unused channel (%s)", async (value) => {
    signInAsAdmin();

    const result = await update({ slackChannelId: value });

    expect(result).toEqual({ error: null });
    expect(savedChannel()).toBe(value);
    expect(h.db.client.findFirst.mock.calls[0][0].where).toEqual({ slackChannelId: value, NOT: { id: CLIENT_ID } });
  });

  it("lets an admin clear the channel", async () => {
    signInAsAdmin();

    const result = await update({ slackChannelId: "" });

    expect(result).toEqual({ error: null });
    expect(savedChannel()).toBeNull();
  });

  it.each([
    ["a person's member ID", "U0ANN12345"],
    ["a direct message ID", "D0123456789"],
    ["a lowercase ID", "c0other5678"],
    ["an ID that is too short", "C0OTHER"],
    ["a channel name", "#client-smile"],
    ["an ID with a space", "C0OTH R5678"],
  ])("refuses an admin entering %s instead of a channel ID", async (_label, value) => {
    signInAsAdmin();

    const result = await update({ slackChannelId: value });

    expect(result.error).toMatch(/isn't a Slack channel ID/i);
    expect(result.error).not.toContain(String.fromCharCode(0x2014));
    expect(h.db.client.update).not.toHaveBeenCalled();
  });

  it("refuses an admin choosing a channel another client already uses", async () => {
    signInAsAdmin();
    h.db.client.findFirst.mockResolvedValue({ id: "client-b" });

    const result = await update({ slackChannelId: OTHER_CHANNEL });

    expect(result.error).toMatch(/another client/i);
    expect(h.db.client.update).not.toHaveBeenCalled();
  });

  it("refuses an admin choosing the team's general channel", async () => {
    signInAsAdmin();

    const result = await update({ slackChannelId: INTERNAL_CHANNEL });

    expect(result.error).toMatch(/general/i);
    expect(h.db.client.update).not.toHaveBeenCalled();
  });

  it("still refuses someone without edit rights, as before", async () => {
    signIn({ caps: [] });

    const result = await update({ contactName: "Dr. Smile", slackChannelId: CURRENT_CHANNEL });

    expect(result.error).toBe("You don't have access to this.");
    expect(h.db.client.update).not.toHaveBeenCalled();
  });
});

describe("adding a client (createClientAction)", () => {
  it("still makes a Slack channel automatically when the box is left blank", async () => {
    signInAsEditor();
    slackCreatesChannel("C0AUTO12345");

    const result = await create({ slackChannelId: "" });

    expect(result).toEqual({ error: null });
    expect(h.db.client.create.mock.calls[0][0].data.slackChannelId).toBeNull();
    expect(slackMethodsCalled()).toContain("conversations.create");
    expect(h.db.client.update).toHaveBeenCalledWith({ where: { id: CLIENT_ID }, data: { slackChannelId: "C0AUTO12345" } });
  });

  it("refuses a creator who is not an admin filling in a channel ID", async () => {
    signInAsEditor();

    const result = await create({ slackChannelId: OTHER_CHANNEL });

    expect(result.error).toMatch(/only an admin/i);
    expect(h.db.client.create).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("lets an admin add a client on an existing unused channel, without making a new one", async () => {
    signInAsAdmin();

    const result = await create({ slackChannelId: OTHER_CHANNEL });

    expect(result).toEqual({ error: null });
    expect(h.db.client.create.mock.calls[0][0].data.slackChannelId).toBe(OTHER_CHANNEL);
    expect(h.db.client.findFirst.mock.calls[0][0].where).toEqual({ slackChannelId: OTHER_CHANNEL });
    expect(slackMethodsCalled()).not.toContain("conversations.create");
  });

  it("refuses an admin adding a client on a channel another client already uses", async () => {
    signInAsAdmin();
    h.db.client.findFirst.mockResolvedValue({ id: "client-b" });

    const result = await create({ slackChannelId: OTHER_CHANNEL });

    expect(result.error).toMatch(/another client/i);
    expect(h.db.client.create).not.toHaveBeenCalled();
  });

  it("refuses an admin adding a client with a member ID instead of a channel ID", async () => {
    signInAsAdmin();

    const result = await create({ slackChannelId: "U0ANN12345" });

    expect(result.error).toMatch(/isn't a Slack channel ID/i);
    expect(h.db.client.create).not.toHaveBeenCalled();
  });
});

describe("the client form's Slack channel help text", () => {
  // The dialog only renders when opened, and there is no browser test setup,
  // so this reads its source.
  const source = readFileSync(resolve(process.cwd(), "src/components/clients/client-form-dialog.tsx"), "utf8");
  const start = source.indexOf('htmlFor="slackChannelId"');
  const help = source.slice(start, source.indexOf("</p>", start));

  it("tells editors that only an admin can change the channel, with no em dash", () => {
    expect(start).toBeGreaterThan(-1);
    expect(help.replace(/\s+/g, " ")).toMatch(/only an admin can change it/i);
    expect(help.slice(help.indexOf("<p"))).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("the admin 'create channel' button (POST /api/admin/notifications/client-channel)", () => {
  it("still makes the channel for a client that has none", async () => {
    signInAsAdmin();
    h.db.client.findUnique.mockResolvedValue({ id: CLIENT_ID, name: "Smile Dental", slackChannelId: null });
    slackCreatesChannel("C0AUTO12345");

    const res = await clientChannelRoute.POST(
      new Request("http://localhost/api/admin/notifications/client-channel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: CLIENT_ID }),
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, channelId: "C0AUTO12345" });
    expect(h.db.client.update).toHaveBeenCalledWith({ where: { id: CLIENT_ID }, data: { slackChannelId: "C0AUTO12345" } });
  });
});
