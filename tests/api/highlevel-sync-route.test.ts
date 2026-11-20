import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HighLevelApiError } from "@/lib/highlevel-errors";

// "Sync now" used to answer every failure with "the token may have been
// revoked". It now says what actually went wrong, and passes along the note
// when only one half of the sync worked.

const syncClientConversations = vi.hoisted(() => vi.fn());
vi.mock("@/lib/highlevel", () => ({
  syncClientConversations: (...args: unknown[]) => syncClientConversations(...args),
}));

const requireClientAccess = vi.hoisted(() => vi.fn());
const requireCapability = vi.hoisted(() => vi.fn());
vi.mock("@/lib/permissions", () => ({
  requireClientAccess: (...args: unknown[]) => requireClientAccess(...args),
  requireCapability: (...args: unknown[]) => requireCapability(...args),
  toErrorResponse: (error: unknown) => {
    throw error;
  },
}));

const route = await import("@/app/api/clients/[clientId]/highlevel/sync/route");

const call = () =>
  route.POST(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ clientId: "client-1" }),
  });

describe("POST /api/clients/[clientId]/highlevel/sync", () => {
  beforeEach(() => {
    requireClientAccess.mockResolvedValue(undefined);
    requireCapability.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    syncClientConversations.mockReset();
  });

  it("a refused token says so, in plain words", async () => {
    syncClientConversations.mockRejectedValue(new HighLevelApiError(401, "Invalid JWT"));
    const res = await call();
    expect(res.status).toBe(502);
    const { error } = await res.json();
    expect(error).toMatch(/refused the token/i);
    expect(error).not.toMatch(/revoked/i);
  });

  it("a missing permission names the permissions", async () => {
    syncClientConversations.mockRejectedValue(new HighLevelApiError(403, "forbidden"));
    const { error } = await (await call()).json();
    expect(error).toContain("conversations/message.readonly");
  });

  it("passes the warnings through when only half the sync worked", async () => {
    syncClientConversations.mockResolvedValue({
      status: "synced",
      upserted: 0,
      pruned: 0,
      warnings: ["Calls were saved, but message history was skipped."],
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).warnings).toEqual(["Calls were saved, but message history was skipped."]);
  });

  it("a client that is not connected is a 400", async () => {
    syncClientConversations.mockResolvedValue({ status: "skipped", reason: "not_connected" });
    expect((await call()).status).toBe(400);
  });
});
