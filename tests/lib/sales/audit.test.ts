import { describe, expect, it, vi } from "vitest";

// recordSalesAudit takes the transaction as an argument, so no real database is
// used. The default `prisma` import is mocked only so loading the module stays inert.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { auditDiff, recordSalesAudit } = await import("@/lib/sales/audit");

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
