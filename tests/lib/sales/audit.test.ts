import { describe, expect, it, vi } from "vitest";

// recordSalesAudit takes the transaction as an argument, so no real database is
// used. The default `prisma` import is mocked only so loading the module stays inert.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { auditDiff, recordSalesAudit, requestMeta } = await import("@/lib/sales/audit");

function fakeTx() {
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => args.data);
  return { tx: { salesAuditLog: { create } } as never, create };
}

const entry = { entityType: "deal", entityId: "d1", action: "update" };

describe("auditDiff", () => {
  it("keeps only the changed keys and drops updatedAt", () => {
    const result = auditDiff(
      { a: 1, b: 2, updatedAt: new Date("2026-01-01") },
      { a: 1, b: 3, updatedAt: new Date("2026-02-01") },
    );
    expect(result).toEqual({ before: { b: 2 }, after: { b: 3 } });
  });

  it("treats equal dates and nested values as unchanged", () => {
    const result = auditDiff(
      { due: new Date("2026-03-01"), tags: ["x", "y"], meta: { n: 1 } },
      { due: new Date("2026-03-01"), tags: ["x", "y"], meta: { n: 1 } },
    );
    expect(result).toEqual({ before: {}, after: {} });
  });

  it("records a key that was added or removed on the side that has it", () => {
    const result = auditDiff({ gone: 1 }, { added: 2 });
    expect(result).toEqual({ before: { gone: 1 }, after: { added: 2 } });
  });

  it("treats a date and something that is not a date as a change", () => {
    const due = new Date("2026-03-01");
    expect(auditDiff({ due }, { due: {} })).toEqual({ before: { due }, after: { due: {} } });
    expect(auditDiff({ due: {} }, { due })).toEqual({ before: { due: {} }, after: { due } });
    expect(auditDiff({ due }, { due: "2026-03-01T00:00:00.000Z" }).after).toEqual({ due: "2026-03-01T00:00:00.000Z" });
  });
});

describe("requestMeta", () => {
  const request = (headers: Record<string, string>) => new Request("http://localhost/api/sales/x", { headers });

  it("takes the first hop of x-forwarded-for and the user agent", () => {
    expect(
      requestMeta(request({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1", "x-real-ip": "10.0.0.9", "user-agent": "Muse/1.0" })),
    ).toEqual({ ipAddress: "203.0.113.7", userAgent: "Muse/1.0" });
  });

  it("falls back to x-real-ip", () => {
    expect(requestMeta(request({ "x-real-ip": "198.51.100.4" }))).toEqual({ ipAddress: "198.51.100.4", userAgent: null });
  });

  it("gives null for both when the headers are missing or blank", () => {
    expect(requestMeta(request({}))).toEqual({ ipAddress: null, userAgent: null });
    expect(requestMeta(request({ "x-forwarded-for": " , 10.0.0.1", "user-agent": "   " }))).toEqual({
      ipAddress: null,
      userAgent: null,
    });
  });
});

describe("recordSalesAudit", () => {
  it("writes a signed-in person as USER with no bot token", async () => {
    const { tx, create } = fakeTx();
    const actor = { userId: "u1", isAdmin: false, seesAllDeals: true, via: "user" as const };
    await recordSalesAudit(tx, actor, { ...entry, after: { title: "Acme" } });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: "USER",
        actorId: "u1",
        botTokenId: null,
        entityType: "deal",
        entityId: "d1",
        action: "update",
        before: undefined,
        after: { title: "Acme" },
        ipAddress: null,
        userAgent: null,
      },
    });
  });

  it("writes a bot as BOT, with the person it works for and the token id", async () => {
    const { tx, create } = fakeTx();
    const actor = { userId: "u2", isAdmin: false, seesAllDeals: true, via: "bot" as const, botTokenId: "tok1" };
    await recordSalesAudit(tx, actor, entry);
    const data = create.mock.calls[0][0].data;
    expect(data.actorType).toBe("BOT");
    expect(data.actorId).toBe("u2");
    expect(data.botTokenId).toBe("tok1");
  });

  it("refuses to write a bot change that does not say which key made it", async () => {
    const { tx, create } = fakeTx();
    const actor = { userId: "u2", isAdmin: false, seesAllDeals: true, via: "bot" } as never;
    await expect(recordSalesAudit(tx, actor, entry)).rejects.toThrow("A bot change must name the bot key that made it.");
    await expect(recordSalesAudit(tx, { ...(actor as object), botTokenId: "" } as never, entry)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("stores the request's IP address and user agent, trimmed and capped at 255 characters", async () => {
    const { tx, create } = fakeTx();
    const actor = { userId: "u1", isAdmin: true, seesAllDeals: true, via: "user" as const };
    await recordSalesAudit(tx, actor, entry, { ipAddress: "  203.0.113.7 ", userAgent: `  ${"a".repeat(300)}  ` });
    const data = create.mock.calls[0][0].data;
    expect(data.ipAddress).toBe("203.0.113.7");
    expect(data.userAgent).toBe("a".repeat(255));
  });

  it("stores an empty IP address or user agent as null", async () => {
    const { tx, create } = fakeTx();
    await recordSalesAudit(tx, { system: "webhook" }, entry, { ipAddress: "   ", userAgent: "" });
    const data = create.mock.calls[0][0].data;
    expect(data.ipAddress).toBeNull();
    expect(data.userAgent).toBeNull();
  });

  it("writes a rule as SYSTEM with no actorId", async () => {
    const { tx, create } = fakeTx();
    await recordSalesAudit(tx, { system: "rule" }, entry);
    const data = create.mock.calls[0][0].data;
    expect(data.actorType).toBe("SYSTEM");
    expect(data.actorId).toBeNull();
    expect(data.botTokenId).toBeNull();
  });

  it("writes an import as SYSTEM and a webhook as WEBHOOK", async () => {
    const { tx, create } = fakeTx();
    await recordSalesAudit(tx, { system: "import" }, entry);
    await recordSalesAudit(tx, { system: "webhook" }, entry);
    expect(create.mock.calls[0][0].data.actorType).toBe("SYSTEM");
    expect(create.mock.calls[1][0].data.actorType).toBe("WEBHOOK");
  });
});
