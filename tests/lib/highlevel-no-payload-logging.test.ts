import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guard for audit finding K8: a HighLevel sync must not copy call or
// voicemail records (caller phone numbers, names, recording links) into the
// server logs. Vercel keeps those logs and Sentry can attach console lines to
// error reports as breadcrumbs.

// Stand-ins for the database and the token decryption, so the sync can run
// without a real database or encryption key. Only the calls the sync makes
// are provided.
const prismaMock = vi.hoisted(() => ({
  clientHighLevelConnection: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  conversationMessage: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/credential-crypto", () => ({ decryptSecret: () => "test-token" }));

import { syncClientConversations } from "@/lib/highlevel";

const CALLER_PHONE = "+15550104477";
const CALLER_NAME = "Jordan Example";
const RECORDING_URL = "https://example.invalid/recordings/call-123.mp3";

const conversations = [{ id: "conv-1", contactId: "contact-1", contactName: CALLER_NAME }];
const messages = [
  {
    id: "msg-call",
    messageType: "TYPE_CALL",
    direction: "inbound",
    dateAdded: "2026-11-01T15:00:00.000Z",
    body: "",
    contactId: "contact-1",
    meta: { call: { status: "completed", from: CALLER_PHONE, duration: 64 } },
    attachments: [RECORDING_URL],
  },
  {
    id: "msg-voicemail",
    messageType: "TYPE_VOICEMAIL",
    direction: "inbound",
    dateAdded: "2026-11-01T16:00:00.000Z",
    body: `Voicemail from ${CALLER_NAME}`,
    contactId: "contact-1",
    meta: { call: { status: "voicemail", from: CALLER_PHONE } },
    attachments: [RECORDING_URL],
  },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const CONSOLE_METHODS = ["log", "info", "debug", "warn", "error", "trace", "dir"] as const;

describe("HighLevel sync does not log call records", () => {
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

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/conversations/search")) return jsonResponse({ conversations });
        if (url.includes("/conversations/conv-1/messages")) return jsonResponse({ messages: { messages } });
        throw new Error(`unexpected fetch in test: ${url}`);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("syncs call and voicemail messages without writing them to the console", async () => {
    const spies = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

    const result = await syncClientConversations("client-1", { force: true });

    // The sync really ran over both records (so a silent console is meaningful).
    expect(result).toEqual({ status: "synced", upserted: 2, pruned: 0 });
    expect(prismaMock.conversationMessage.upsert).toHaveBeenCalledTimes(2);

    const logged = spies.flatMap((spy) => spy.mock.calls).map((args) =>
      args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")
    );
    expect(logged).toEqual([]);
  });
});

describe("HighLevel debug log marker", () => {
  const SRC = join(process.cwd(), "src");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it("is not left anywhere in the app source", () => {
    const offenders = sourceFiles(SRC)
      .filter((full) => readFileSync(full, "utf8").includes("[HL-DEBUG]"))
      .map((full) => relative(process.cwd(), full).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });

  it("src/lib/highlevel.ts has no debug-level console output", () => {
    const text = readFileSync(join(SRC, "lib", "highlevel.ts"), "utf8");
    expect(text).not.toMatch(/\bconsole\.(?:log|info|debug|trace|dir)\s*\(/);
  });
});
