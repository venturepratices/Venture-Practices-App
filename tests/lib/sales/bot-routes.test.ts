import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin Bots routes, run directly with a fake database and a fake admin
// check. Nothing here reaches a real database or a real session.

const requireAdminMock = vi.fn();
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, requireAdmin: () => requireAdminMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
const db = { bots: [] as Row[], audits: [] as Row[] };
const teamMemberFindFirst = vi.fn();
const pipelineFindMany = vi.fn();

// Like Prisma, return only the selected fields (the routes never select the hash).
function withPerson(row: Row, select?: Record<string, unknown>) {
  const full: Row = { ...row, actingFor: { id: row.actingForId, name: "Sarah K." } };
  return select ? Object.fromEntries(Object.keys(select).map((key) => [key, full[key]])) : full;
}

const botDelegate = {
  findMany: async (args: { select?: Row } = {}) => db.bots.map((row) => withPerson(row, args.select)),
  findUnique: async (args: { where: { id: string }; select?: Row }) => {
    const row = db.bots.find((b) => b.id === args.where.id);
    return row ? withPerson(row, args.select) : null;
  },
  create: async (args: { data: Row; select?: Row }) => {
    const row = { id: `b${db.bots.length + 1}`, enabled: true, createdAt: new Date(), lastUsedAt: null, rotatedAt: null, ...args.data };
    db.bots.push(row);
    return withPerson(row, args.select);
  },
  update: async (args: { where: { id: string }; data: Row; select?: Row }) => {
    const row = db.bots.find((b) => b.id === args.where.id)!;
    // Prisma leaves a field alone when its value is undefined.
    Object.assign(row, Object.fromEntries(Object.entries(args.data).filter(([, value]) => value !== undefined)));
    return withPerson(row, args.select);
  },
};
const tx = {
  botToken: botDelegate,
  salesAuditLog: { create: async (args: { data: Row }) => db.audits.push(args.data) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    botToken: botDelegate,
    teamMember: { findFirst: (...args: unknown[]) => teamMemberFindFirst(...args) },
    salesPipeline: { findMany: (...args: unknown[]) => pipelineFindMany(...args) },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}));

const listRoute = await import("@/app/api/sales/bots/route");
const botRoute = await import("@/app/api/sales/bots/[botId]/route");
const { PermissionError } = await import("@/lib/permissions");
const { SALES_MEMBER_WHERE } = await import("@/lib/sales/access");

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const json = (body: unknown) => JSON.stringify(body);
const req = (method: string, body?: unknown, url = "http://localhost/api/sales/bots") =>
  new Request(url, { method, body: body === undefined ? undefined : json(body), headers: { "content-type": "application/json" } });
const ctx = (botId: string) => ({ params: Promise.resolve({ botId }) });

async function createBot(body: Row = {}) {
  const res = await listRoute.POST(req("POST", { name: "Muse", actingForId: "p1", role: "helper", ...body }));
  return { res, body: (await res.json()) as Row };
}

beforeEach(() => {
  db.bots = [];
  db.audits = [];
  requireAdminMock.mockReset().mockResolvedValue({ userId: "admin1", isAdmin: true });
  teamMemberFindFirst.mockReset().mockResolvedValue({ id: "p1" });
  pipelineFindMany.mockReset().mockImplementation(async (args: { where: { key: { in: string[] } } }) =>
    args.where.key.in.filter((k) => k === "direct-mail").map((key) => ({ key })),
  );
});

describe("admin only", () => {
  it("refuses a member who is not an admin", async () => {
    requireAdminMock.mockRejectedValue(new PermissionError(403, "This action is for admins only."));
    expect((await listRoute.GET()).status).toBe(403);
    expect((await listRoute.POST(req("POST", {}))).status).toBe(403);
    expect((await botRoute.PATCH(req("PATCH", { enabled: false }), ctx("b1"))).status).toBe(403);
    expect((await botRoute.POST(req("POST", undefined, "http://localhost/api/sales/bots/b1?action=rotate"), ctx("b1"))).status).toBe(403);
  });
});

describe("POST /api/sales/bots", () => {
  it("returns the key once and stores only its hash", async () => {
    const { res, body } = await createBot();
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const secret = body.secret as string;
    expect(secret).toMatch(/^vpb_/);
    expect(db.bots[0].tokenHash).toBe(sha256(secret));
    expect(db.bots[0].tokenLast4).toBe(secret.slice(-4));
    expect(db.bots[0].scopes).toEqual(["read", "notes", "activities"]);
    expect(db.bots[0].createdById).toBe("admin1");
    expect(json(body.bot)).not.toContain(secret);
    expect(json(body.bot)).not.toContain(sha256(secret));
  });

  it("writes a history row with no key and no hash", async () => {
    const { body } = await createBot();
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({ actorType: "USER", actorId: "admin1", entityType: "BotToken", action: "created" });
    const written = json(db.audits[0]);
    expect(written).not.toContain(body.secret as string);
    expect(written).not.toContain(db.bots[0].tokenHash as string);
    expect(written).not.toContain("tokenLast4");
  });

  it("only lets a bot work for someone with Sales access", async () => {
    teamMemberFindFirst.mockResolvedValue(null);
    const { res, body } = await createBot({ actingForId: "robert" });
    expect(res.status).toBe(400);
    expect(body.error).toBe("Choose a team member with Sales access.");
    expect(teamMemberFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "robert", ...SALES_MEMBER_WHERE } }));
    expect(db.bots).toHaveLength(0);
  });

  it("refuses scopes that do not exist, such as delete", async () => {
    const { res } = await createBot({ role: undefined, scopes: ["read", "delete"] });
    expect(res.status).toBe(400);
    expect(db.bots).toHaveLength(0);
  });

  it("refuses a role and a scope list together", async () => {
    const { res } = await createBot({ role: "rep", scopes: ["read"] });
    expect(res.status).toBe(400);
  });

  it("stores hand-picked scopes once each, in the standard order", async () => {
    await createBot({ role: undefined, scopes: ["move", "read", "move"] });
    expect(db.bots[0].scopes).toEqual(["read", "move"]);
  });

  it("refuses a pipeline that does not exist", async () => {
    const { res, body } = await createBot({ pipelineKeys: ["direct-mail", "nope"] });
    expect(res.status).toBe(400);
    expect(body.error).toBe("Unknown pipeline: nope.");
    expect(db.bots).toHaveLength(0);
  });

  it("accepts known pipelines", async () => {
    const { res } = await createBot({ pipelineKeys: ["direct-mail"] });
    expect(res.status).toBe(201);
    expect(db.bots[0].pipelineKeys).toEqual(["direct-mail"]);
  });
});

describe("GET /api/sales/bots", () => {
  it("shows a masked key and never the hash", async () => {
    const { body: created } = await createBot();
    const secret = created.secret as string;
    const res = await listRoute.GET();
    const body = (await res.json()) as { bots: Row[] };
    expect(body.bots).toHaveLength(1);
    expect(body.bots[0].maskedKey).toBe(`vpb_••••${secret.slice(-4)}`);
    expect(json(body)).not.toContain(sha256(secret));
    expect(json(body)).not.toContain(secret);
    expect(body.bots[0]).not.toHaveProperty("tokenHash");
  });
});

describe("PATCH /api/sales/bots/[botId]", () => {
  it("turns a bot off and logs only what changed", async () => {
    await createBot();
    const res = await botRoute.PATCH(req("PATCH", { enabled: false }), ctx("b1"));
    expect(res.status).toBe(200);
    expect(db.bots[0].enabled).toBe(false);
    expect(db.audits[1]).toMatchObject({ action: "updated" });
    expect(db.audits[1].before).toEqual({ enabled: true });
    expect(db.audits[1].after).toEqual({ enabled: false });
  });

  it("changes the role", async () => {
    await createBot();
    await botRoute.PATCH(req("PATCH", { role: "rep" }), ctx("b1"));
    expect(db.bots[0].scopes).toEqual(["read", "notes", "activities", "move", "create"]);
  });

  it("checks new pipelines exist", async () => {
    await createBot();
    const res = await botRoute.PATCH(req("PATCH", { pipelineKeys: ["nope"] }), ctx("b1"));
    expect(res.status).toBe(400);
  });

  it("refuses an empty change", async () => {
    await createBot();
    expect((await botRoute.PATCH(req("PATCH", {}), ctx("b1"))).status).toBe(400);
  });

  it("gives 404 for an unknown bot", async () => {
    expect((await botRoute.PATCH(req("PATCH", { enabled: false }), ctx("missing"))).status).toBe(404);
  });
});

describe("POST /api/sales/bots/[botId]?action=rotate", () => {
  const rotate = (botId: string, action = "rotate") =>
    botRoute.POST(req("POST", undefined, `http://localhost/api/sales/bots/${botId}?action=${action}`), ctx(botId));

  it("replaces the key, returns the new one once, and logs without it", async () => {
    const { body: created } = await createBot();
    const res = await rotate("b1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Row;
    const secret = body.secret as string;
    expect(secret).not.toBe(created.secret);
    expect(db.bots[0].tokenHash).toBe(sha256(secret));
    expect(db.bots[0].rotatedAt).toBeInstanceOf(Date);
    expect(db.audits[1]).toMatchObject({ entityType: "BotToken", entityId: "b1", action: "rotated" });
    expect(json(db.audits[1])).not.toContain(secret);
    expect(json(db.audits[1])).not.toContain(sha256(secret));
  });

  it("refuses any other action", async () => {
    await createBot();
    expect((await rotate("b1", "export")).status).toBe(400);
  });

  it("gives 404 for an unknown bot", async () => {
    expect((await rotate("missing")).status).toBe(404);
  });
});
