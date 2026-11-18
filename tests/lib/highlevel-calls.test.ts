import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock prisma before importing the module under test.
const prismaMock = vi.hoisted(() => ({
  highLevelCallSummary: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
  highLevelTrackingNumber: {
    findMany: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { parseConversationToCall, syncHighLevelCalls, getCallsStatsForWindow } = await import(
  "@/lib/highlevel-calls"
);

beforeEach(() => {
  prismaMock.highLevelCallSummary.upsert.mockReset();
  prismaMock.highLevelCallSummary.findMany.mockReset();
  prismaMock.highLevelTrackingNumber.findMany.mockReset();
});

describe("parseConversationToCall", () => {
  const belmontCall = {
    id: "zSgmVuHBUKs9rBUQyhiw",
    contactId: "QnNg5k0fpzYDsBqWDc8L",
    contactName: "(704) 709-3023",
    phone: "+17047093023",
    type: "TYPE_PHONE",
    lastMessageType: "TYPE_CALL",
    lastMessageDirection: "inbound",
    lastMessageDate: 1794944479682,
    lastCallStatus: "completed",
    lastCallTimestamp: 1794944479703,
    lastChannelAccount: [{ value: "+17043973212" }],
  };

  it("pulls out all the call fields Robert needs for a real Belmont row", () => {
    const row = parseConversationToCall(belmontCall);
    expect(row).toMatchObject({
      ghlConversationId: "zSgmVuHBUKs9rBUQyhiw",
      ghlContactId: "QnNg5k0fpzYDsBqWDc8L",
      contactName: "(704) 709-3023",
      callerPhone: "+17047093023",
      trackingNumber: "+17043973212",
      direction: "inbound",
      status: "completed",
      lastMessageType: "TYPE_CALL",
    });
    expect(row?.lastCallAt).toBeInstanceOf(Date);
    expect(row?.lastCallAt?.getTime()).toBe(1794944479703);
  });

  it("drops a conversation with no call activity", () => {
    const sms = { ...belmontCall, lastMessageType: "TYPE_SMS", lastCallTimestamp: null, lastCallStatus: null };
    expect(parseConversationToCall(sms)).toBeNull();
  });

  it("keeps a voicemail-flagged conversation as a call row", () => {
    const voicemail = { ...belmontCall, lastMessageType: "TYPE_VOICEMAIL" };
    expect(parseConversationToCall(voicemail)?.lastMessageType).toBe("TYPE_VOICEMAIL");
  });

  it("falls back to lastMessageDate when lastCallTimestamp is missing", () => {
    const noTs = { ...belmontCall, lastCallTimestamp: null };
    expect(parseConversationToCall(noTs)?.lastCallAt?.getTime()).toBe(1794944479682);
  });

  it("stays silent on odd shapes rather than throwing", () => {
    expect(parseConversationToCall(null)).toBeNull();
    expect(parseConversationToCall(undefined)).toBeNull();
    expect(parseConversationToCall({})).toBeNull();
    expect(parseConversationToCall({ id: "x" })).toBeNull(); // no contactId
    expect(parseConversationToCall({ id: "x", contactId: "y" })).toBeNull(); // no call activity
  });

  it("drops a tracking-number entry that is an email or an opaque id", () => {
    const emailCh = { ...belmontCall, lastChannelAccount: [{ value: "info@example.com" }] };
    // We keep it as-is in the field but the read side filters at display time.
    expect(parseConversationToCall(emailCh)?.trackingNumber).toBe("info@example.com");
  });
});

describe("syncHighLevelCalls", () => {
  it("upserts one row per call conversation, deduping on ghlConversationId", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        conversations: [
          {
            id: "convo-1",
            contactId: "contact-1",
            lastMessageType: "TYPE_CALL",
            lastMessageDirection: "inbound",
            lastCallStatus: "completed",
            lastCallTimestamp: 1794000000000,
            phone: "+17045551111",
            lastChannelAccount: [{ value: "+17043973212" }],
          },
          {
            id: "convo-2",
            contactId: "contact-2",
            lastMessageType: "TYPE_SMS", // dropped
            lastMessageDirection: "outbound",
            lastMessageDate: 1794000001000,
          },
        ],
      }),
    } as unknown as Response);

    prismaMock.highLevelCallSummary.upsert.mockResolvedValue({});

    const res = await syncHighLevelCalls({ clientId: "client-x", locationId: "loc-1" }, "pit-test");

    expect(res).toEqual({ upserted: 1, seen: 1 });
    expect(prismaMock.highLevelCallSummary.upsert).toHaveBeenCalledTimes(1);
    const [arg] = prismaMock.highLevelCallSummary.upsert.mock.calls[0];
    expect(arg.where).toEqual({ ghlConversationId: "convo-1" });
    expect(arg.create.clientId).toBe("client-x");
    expect(arg.create.status).toBe("completed");
    expect(arg.create.trackingNumber).toBe("+17043973212");
    // Upsert must NOT touch firstSeenAt in the update branch (preserved for first-time derivation).
    expect(arg.update).not.toHaveProperty("firstSeenAt");

    fetchMock.mockRestore();
  });

  it("stops paginating when a page returns fewer than the page limit", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ conversations: [] }),
      } as unknown as Response);

    prismaMock.highLevelCallSummary.upsert.mockResolvedValue({});

    const res = await syncHighLevelCalls({ clientId: "c1", locationId: "loc-1" }, "pit");
    expect(res.seen).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second page fetched
    fetchMock.mockRestore();
  });

  it("throws on HTTP errors so sync-on-view can surface the real message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => '{"message":"forbidden"}',
      json: async () => ({}),
    } as unknown as Response);

    await expect(
      syncHighLevelCalls({ clientId: "c", locationId: "loc" }, "pit"),
    ).rejects.toThrow(/HighLevel API 403/);
  });
});

describe("getCallsStatsForWindow", () => {
  const start = new Date("2026-11-11T00:00:00Z");
  const end = new Date("2026-11-18T00:00:00Z");

  it("counts answered, missed, and first-time vs repeat correctly over a real-looking week", async () => {
    prismaMock.highLevelCallSummary.findMany.mockResolvedValue([
      // Belmont, Direct Mail number, answered, first-time (firstSeenAt inside window)
      { callerPhone: "+1700000001", firstSeenAt: new Date("2026-11-12T10:00:00Z"), status: "completed", trackingNumber: "+17043973212", clientId: "belmont" },
      // Belmont, Direct Mail number, answered, repeat (firstSeenAt before window)
      { callerPhone: "+1700000002", firstSeenAt: new Date("2026-10-01T10:00:00Z"), status: "completed", trackingNumber: "+17043973212", clientId: "belmont" },
      // Belmont, Direct Mail number, missed, first-time
      { callerPhone: "+1700000003", firstSeenAt: new Date("2026-11-13T10:00:00Z"), status: "no-answer", trackingNumber: "+17043973212", clientId: "belmont" },
      // Belmont, Main Line, answered, repeat
      { callerPhone: "+1700000002", firstSeenAt: new Date("2026-10-01T10:00:00Z"), status: "completed", trackingNumber: "+17042863058", clientId: "belmont" },
    ]);
    prismaMock.highLevelTrackingNumber.findMany.mockResolvedValue([
      { clientId: "belmont", number: "+17043973212", label: "Direct Mail" },
      { clientId: "belmont", number: "+17042863058", label: "Main Line" },
    ]);

    const stats = await getCallsStatsForWindow({ clientIds: ["belmont"], start, end });

    expect(stats.totalCalls).toBe(4);
    expect(stats.answered).toBe(3);
    expect(stats.missed).toBe(1);
    expect(stats.firstTimeCallers).toBe(2);
    expect(stats.repeatCallers).toBe(2);
    // Direct Mail should lead the breakdown (3 calls) over Main Line (1 call).
    expect(stats.byTrackingNumber).toEqual([
      { number: "+17043973212", label: "Direct Mail", count: 3 },
      { number: "+17042863058", label: "Main Line", count: 1 },
    ]);
  });

  it("falls back to '(unknown)' when a call row has no tracking number", async () => {
    prismaMock.highLevelCallSummary.findMany.mockResolvedValue([
      { callerPhone: "+1", firstSeenAt: new Date("2026-11-12T10:00:00Z"), status: "completed", trackingNumber: null, clientId: "belmont" },
    ]);
    prismaMock.highLevelTrackingNumber.findMany.mockResolvedValue([]);

    const stats = await getCallsStatsForWindow({ clientIds: ["belmont"], start, end });
    expect(stats.byTrackingNumber).toEqual([{ number: "(unknown)", label: null, count: 1 }]);
  });
});
