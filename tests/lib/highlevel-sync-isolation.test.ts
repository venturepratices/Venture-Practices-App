import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Robert's call numbers come from the call part of the HighLevel sync. That
// part used to run LAST, after the message part, so any failure while pulling
// messages (a token without the message permission, a blocked HIPAA account)
// meant the call numbers never loaded. These pin the new order: calls first,
// and each part fails on its own.

const prismaMock = vi.hoisted(() => ({
  clientHighLevelConnection: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  conversationMessage: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  highLevelCallSummary: { upsert: vi.fn() },
}));
const decryptMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/credential-crypto", () => ({ decryptSecret: decryptMock }));

import { syncCallsForAllConnectedClients, syncClientConversations } from "@/lib/highlevel";
import { HighLevelApiError, HighLevelTokenUnreadableError } from "@/lib/highlevel-errors";

const callConversation = {
  id: "conv-call",
  contactId: "contact-1",
  contactName: "(704) 555-0100",
  phone: "+17045550100",
  lastMessageType: "TYPE_CALL",
  lastMessageDirection: "inbound",
  lastCallStatus: "completed",
  lastCallTimestamp: 1794000000000,
  lastChannelAccount: [{ value: "+17043973212" }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Routes = { search: () => Response; messages: () => Response };

function stubFetch(routes: Routes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/conversations/search")) return routes.search();
      if (url.includes("/messages")) return routes.messages();
      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
}

describe("syncClientConversations: calls first, each part on its own", () => {
  beforeEach(() => {
    prismaMock.clientHighLevelConnection.findUnique.mockResolvedValue({
      clientId: "client-1",
      locationId: "loc-1",
      encryptedToken: "encrypted",
      lastSyncAt: null,
    });
    prismaMock.clientHighLevelConnection.update.mockResolvedValue({});
    prismaMock.conversationMessage.upsert.mockResolvedValue({});
    prismaMock.conversationMessage.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.conversationMessage.findMany.mockResolvedValue([]);
    prismaMock.highLevelCallSummary.upsert.mockResolvedValue({});
    decryptMock.mockReturnValue("test-token");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("still saves the calls when the messages part is refused (403)", async () => {
    stubFetch({
      search: () => json({ conversations: [callConversation] }),
      messages: () => json({ message: "forbidden" }, 403),
    });

    const result = await syncClientConversations("client-1", { force: true });

    expect(prismaMock.highLevelCallSummary.upsert).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("synced");
    expect(result).toMatchObject({ status: "synced", upserted: 0 });
    const warnings = (result as { warnings?: string[] }).warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/message history was skipped/i);
    expect(warnings[0]).toContain("conversations/message.readonly");
    // A part worked, so the "last synced" time moves.
    expect(prismaMock.clientHighLevelConnection.update).toHaveBeenCalledTimes(1);
  });

  it("runs the call part before any message is requested", async () => {
    const order: string[] = [];
    prismaMock.highLevelCallSummary.upsert.mockImplementation(async () => {
      order.push("call-saved");
      return {};
    });
    prismaMock.conversationMessage.upsert.mockImplementation(async () => {
      order.push("message-saved");
      return {};
    });
    stubFetch({
      search: () => json({ conversations: [callConversation] }),
      messages: () =>
        json({
          messages: {
            messages: [
              {
                id: "msg-1",
                messageType: "TYPE_SMS",
                direction: "inbound",
                dateAdded: "2026-11-01T15:00:00.000Z",
                body: "hello",
                contactId: "contact-1",
              },
            ],
          },
        }),
    });

    const result = await syncClientConversations("client-1", { force: true });

    expect(order[0]).toBe("call-saved");
    expect(order).toContain("message-saved");
    expect(result).toMatchObject({ status: "synced", upserted: 1 });
    expect((result as { warnings?: string[] }).warnings).toBeUndefined();
  });

  it("keeps the messages when only the calls part fails, and says so", async () => {
    prismaMock.highLevelCallSummary.upsert.mockRejectedValue(new Error("db hiccup"));
    stubFetch({
      search: () => json({ conversations: [callConversation] }),
      messages: () =>
        json({
          messages: {
            messages: [
              {
                id: "msg-1",
                messageType: "TYPE_SMS",
                direction: "inbound",
                dateAdded: "2026-11-01T15:00:00.000Z",
                body: "hello",
                contactId: "contact-1",
              },
            ],
          },
        }),
    });

    const result = await syncClientConversations("client-1", { force: true });

    expect(result).toMatchObject({ status: "synced", upserted: 1 });
    const warnings = (result as { warnings?: string[] }).warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/call details were skipped/i);
  });

  it("throws the HighLevel error when both parts fail, and leaves lastSyncAt alone", async () => {
    stubFetch({
      search: () => json({ message: "Invalid JWT" }, 401),
      messages: () => json({ message: "Invalid JWT" }, 401),
    });

    await expect(syncClientConversations("client-1", { force: true })).rejects.toMatchObject({
      status: 401,
    });
    await expect(syncClientConversations("client-1", { force: true })).rejects.toBeInstanceOf(
      HighLevelApiError,
    );
    expect(prismaMock.clientHighLevelConnection.update).not.toHaveBeenCalled();
  });

  it("an unreadable saved token throws a clear error before any request", async () => {
    decryptMock.mockImplementation(() => {
      throw new Error("Unsupported state or unable to authenticate data");
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(syncClientConversations("client-1", { force: true })).rejects.toBeInstanceOf(
      HighLevelTokenUnreadableError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not write call records to the log when a part fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch({
      search: () => json({ conversations: [callConversation] }),
      messages: () => json({ message: "forbidden" }, 403),
    });

    await syncClientConversations("client-1", { force: true });

    const logged = warn.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).not.toContain("+17045550100");
    expect(logged).not.toContain("(704) 555-0100");
  });
});

describe("syncCallsForAllConnectedClients: one client never stops the others", () => {
  beforeEach(() => {
    prismaMock.highLevelCallSummary.upsert.mockResolvedValue({});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("an unreadable token on one client still lets the next one sync", async () => {
    prismaMock.clientHighLevelConnection.findMany.mockResolvedValue([
      { clientId: "belmont", locationId: "loc-b", encryptedToken: "bad" },
      { clientId: "gaston", locationId: "loc-g", encryptedToken: "good" },
    ]);
    decryptMock.mockImplementation((value: string) => {
      if (value === "bad") throw new Error("cannot decrypt");
      return "test-token";
    });
    stubFetch({
      search: () => json({ conversations: [callConversation] }),
      messages: () => {
        throw new Error("the daily job must never ask for messages");
      },
    });

    const result = await syncCallsForAllConnectedClients();

    expect(result.clients).toBe(2);
    expect(result.synced).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].clientId).toBe("belmont");
    expect(result.failures[0].error).toMatch(/saved token/i);
    expect(prismaMock.highLevelCallSummary.upsert).toHaveBeenCalledTimes(1);
  });

  it("a HighLevel refusal on one client is listed in plain words, others continue", async () => {
    prismaMock.clientHighLevelConnection.findMany.mockResolvedValue([
      { clientId: "a", locationId: "loc-a", encryptedToken: "t1" },
      { clientId: "b", locationId: "loc-b", encryptedToken: "t2" },
    ]);
    decryptMock.mockImplementation((value: string) => (value === "t1" ? "token-a" : "token-b"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string>)?.Authorization;
        return auth === "Bearer token-a"
          ? json({ message: "Invalid JWT" }, 401)
          : json({ conversations: [callConversation] });
      }),
    );

    const result = await syncCallsForAllConnectedClients();

    expect(result.synced).toBe(1);
    expect(result.failures).toEqual([
      { clientId: "a", error: expect.stringMatching(/refused the token/i) },
    ]);
  });
});
