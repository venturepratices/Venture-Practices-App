import { beforeEach, describe, expect, it, vi } from "vitest";

// Account manager on a client (Ben's 2026-11-20 meeting): one optional team
// member who owns the client. The real permission helpers run over a mocked
// database. The rules pinned here: only a real team member can be picked, "not
// assigned" clears it, a form that does not send the field never wipes it, and
// a stored manager who has since left the team never blocks saving the client.

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
  };
});

vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/activity-log", () => ({ logActivity: h.logActivity }));
vi.mock("@/lib/slack", () => ({ ensureClientChannel: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const { CAPABILITIES } = await import("@/lib/permission-catalog");
const { createClientAction, updateClientAction } = await import("@/lib/actions/clients");

const MEMBER_ID = "member-1";
const CLIENT_ID = "client-a";
const ASHLEY = "member-ashley";
const GONE = "member-gone";
const NOTHING_SAVED = { error: null };

function signInAsEditor() {
  const caps = Object.fromEntries(CAPABILITIES.map((cap) => [cap, ["canEditClients", "canCreateClients"].includes(cap)]));
  h.auth.mockResolvedValue({ user: { id: MEMBER_ID, name: "Staff Member" } });
  h.db.teamMember.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    if (where.id === MEMBER_ID) {
      return { id: MEMBER_ID, isAdmin: false, allClientsAccess: false, clientAccess: [{ clientId: CLIENT_ID }], ...caps };
    }
    if (where.id === ASHLEY) return { id: ASHLEY, name: "Ashley S." };
    return null;
  });
}

function storedClient(accountManagerId: string | null = null) {
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
    slackChannelId: null,
    accountManagerId,
  };
}

function clientForm(fields: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = { name: "Smile Dental", status: "ACTIVE", slackChannelId: "", ...fields };
  const form = new FormData();
  for (const [key, value] of Object.entries(all)) if (value !== undefined) form.set(key, value);
  return form;
}

const update = (fields: Record<string, string | undefined>) => updateClientAction(CLIENT_ID, NOTHING_SAVED, clientForm(fields));
const create = (fields: Record<string, string | undefined>) => createClientAction(NOTHING_SAVED, clientForm(fields));

function savedData(call: "update" | "create") {
  return h.db.client[call].mock.calls[0][0].data as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockReset();
  for (const model of Object.values(h.db)) {
    for (const method of Object.values(model)) method.mockReset();
  }
  signInAsEditor();
  h.db.client.findUnique.mockResolvedValue(storedClient());
  h.db.client.findFirst.mockResolvedValue(null);
  h.db.client.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...storedClient(), ...data }));
  h.db.client.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...storedClient(), ...data }));
});

describe("what the form sends for the account manager (clientSchema)", () => {
  const base = { name: "Smile Dental", status: "ACTIVE" as const };

  it.each([
    ["is missing, which leaves the stored manager alone", undefined, undefined],
    ["is blank", "", null],
    ['is "not assigned"', "none", null],
    ["is a team member's id", "member-ashley", "member-ashley"],
  ])("reads the field as %s", async (_label, sent, expected) => {
    const { clientSchema } = await import("@/lib/validations/client");

    const parsed = clientSchema.parse({ ...base, accountManagerId: sent });

    expect(parsed.accountManagerId).toBe(expected);
  });
});

describe("editing a client's account manager (updateClientAction)", () => {
  it("saves a real team member as the account manager and says so in the activity log", async () => {
    const result = await update({ accountManagerId: ASHLEY });

    expect(result).toEqual({ error: null });
    expect(savedData("update").accountManagerId).toBe(ASHLEY);
    expect(h.logActivity.mock.calls[0][0].description).toContain("account manager set to Ashley S.");
  });

  it("refuses someone who is not on the team, and saves nothing", async () => {
    const result = await update({ accountManagerId: GONE });

    expect(result.error).toMatch(/isn't on the team/i);
    expect(result.error).not.toContain(String.fromCharCode(0x2014));
    expect(h.db.client.update).not.toHaveBeenCalled();
  });

  it('clears the account manager when "not assigned" is picked', async () => {
    h.db.client.findUnique.mockResolvedValue(storedClient(ASHLEY));

    const result = await update({ accountManagerId: "none" });

    expect(result).toEqual({ error: null });
    expect(savedData("update").accountManagerId).toBeNull();
    expect(h.logActivity.mock.calls[0][0].description).toContain("account manager cleared");
  });

  it("leaves the account manager alone when the form does not send the field", async () => {
    h.db.client.findUnique.mockResolvedValue(storedClient(ASHLEY));

    const result = await update({ contactName: "Dr. Smile" });

    expect(result).toEqual({ error: null });
    expect(savedData("update").accountManagerId).toBeUndefined();
  });

  it("still saves the client when the stored manager has since left the team and is sent back unchanged", async () => {
    h.db.client.findUnique.mockResolvedValue(storedClient(GONE));

    const result = await update({ about: "Updated", accountManagerId: GONE });

    expect(result).toEqual({ error: null });
    expect(savedData("update").accountManagerId).toBe(GONE);
  });

  it("does not log an account manager change when it did not change", async () => {
    h.db.client.findUnique.mockResolvedValue(storedClient(ASHLEY));

    await update({ about: "Updated", accountManagerId: ASHLEY });

    expect(h.logActivity.mock.calls[0][0].description).not.toMatch(/account manager/i);
  });
});

describe("adding a client with an account manager (createClientAction)", () => {
  it("saves the chosen team member", async () => {
    const result = await create({ accountManagerId: ASHLEY });

    expect(result).toEqual({ error: null });
    expect(savedData("create").accountManagerId).toBe(ASHLEY);
  });

  it('adds the client as not assigned when "not assigned" is picked or the field is missing', async () => {
    await create({ accountManagerId: "none" });
    expect(savedData("create").accountManagerId ?? null).toBeNull();

    h.db.client.create.mockClear();
    await create({});
    expect(savedData("create").accountManagerId ?? null).toBeNull();
  });

  it("refuses someone who is not on the team, and adds nothing", async () => {
    const result = await create({ accountManagerId: GONE });

    expect(result.error).toMatch(/isn't on the team/i);
    expect(h.db.client.create).not.toHaveBeenCalled();
  });
});
