import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A deal's custom fields (Details in the deal panel): how a typed value is
// checked and stored, and the territory hold rule wired to the "Territory Hold
// Expiry" field (spec rule 4): setting the date adds a Deadline 7 days before,
// changing it moves the check, clearing it removes the check. Run against a
// small fake database that records every call.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; data: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;

const now = new Date("2026-11-05T15:00:00Z");
const owner: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "b", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };
const meta = { ipAddress: "203.0.113.9", userAgent: null };

const FIELDS: Row[] = [
  { id: "f-start", key: "target-start-date", label: "Target Start Date", entity: "DEAL", fieldType: "DATE", options: [], pipelineKeys: [] },
  {
    id: "f-hold",
    key: "territory-hold-expiry",
    label: "Territory Hold Expiry",
    entity: "DEAL",
    fieldType: "DATE",
    options: [],
    pipelineKeys: ["direct-mail", "new-mover-mail"],
  },
  {
    id: "f-eng",
    key: "engagement-type",
    label: "Engagement Type",
    entity: "DEAL",
    fieldType: "SELECT",
    options: ["Growth strategy", "Start-up", "Marketing systems"],
    pipelineKeys: ["marketing-agency"],
  },
  { id: "f-zip", key: "practice-zip", label: "Practice ZIP", entity: "LEAD", fieldType: "TEXT", options: [], pipelineKeys: [] },
];

const state = {
  deal: null as Row | null,
  values: [] as Row[],
  activities: [] as Row[],
  audits: [] as Row[],
};

const db = {
  salesDeal: {
    findFirst: vi.fn(async (args: Args) => {
      const deal = state.deal;
      if (!deal || deal.id !== args.where.id || deal.archivedAt !== null) return null;
      if (args.where.ownerId !== undefined && deal.ownerId !== args.where.ownerId) return null;
      return deal;
    }),
  },
  salesCustomField: {
    findFirst: vi.fn(
      async (args: Args) =>
        FIELDS.find((f) => f.key === args.where.key && (args.where.entity === undefined || f.entity === args.where.entity)) ??
        null,
    ),
  },
  salesCustomFieldValue: {
    findUnique: vi.fn(async (args: Args) => {
      const key = args.where.fieldId_dealId as Row;
      return state.values.find((v) => v.fieldId === key.fieldId && v.dealId === key.dealId) ?? null;
    }),
    upsert: vi.fn(async (args: Args) => ({ id: "v-new", ...(args.create as Row) })),
    delete: vi.fn(async () => ({})),
  },
  salesActivity: {
    findMany: vi.fn(async (args: Args) =>
      state.activities.filter(
        (a) =>
          a.dealId === args.where.dealId &&
          a.createdBy === args.where.createdBy &&
          a.doneAt === null &&
          a.archivedAt === null,
      ),
    ),
    updateMany: vi.fn(async () => ({ count: 1 })),
    create: vi.fn(async (args: Args) => ({ id: "act-new", ...args.data })),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => state.audits.push(args.data)) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { normalizeFieldValue } = await import("@/lib/sales/custom-fields");
const { setDealField } = await import("@/lib/sales/deals");
const fieldRoute = await import("@/app/api/sales/deals/[dealId]/fields/[fieldKey]/route");
const { endOfDay } = await import("@/lib/utils");

const writes = () => [
  ...db.salesCustomFieldValue.upsert.mock.calls,
  ...db.salesCustomFieldValue.delete.mock.calls,
  ...db.salesActivity.updateMany.mock.calls,
  ...db.salesActivity.create.mock.calls,
  ...db.salesAuditLog.create.mock.calls,
];
const HOLD_KEY = { fieldId_dealId: { fieldId: "f-hold", dealId: "d1" } };
const openCheck = { id: "a-hold", dealId: "d1", type: "DEADLINE", subject: "Territory hold check", createdBy: "rule:territory-hold", doneAt: null, archivedAt: null };

beforeEach(() => {
  for (const delegate of Object.values(db)) {
    if (typeof delegate === "function") delegate.mockClear();
    else for (const fn of Object.values(delegate)) fn.mockClear();
  }
  state.deal = { id: "d1", ownerId: "r", archivedAt: null, pipeline: { key: "direct-mail" } };
  state.values = [];
  state.activities = [];
  state.audits = [];
  requireSalesUserMock.mockReset().mockResolvedValue(owner);
});

describe("normalizeFieldValue", () => {
  type Shape = import("@/lib/sales/custom-fields").CustomFieldShape;
  const date: Shape = { fieldType: "DATE", options: [] };
  const number: Shape = { fieldType: "NUMBER", options: [] };
  const select: Shape = { fieldType: "SELECT", options: ["90-day trial", "Full program", "Not sure yet"] };
  const text: Shape = { fieldType: "TEXT", options: [] };

  it("keeps real dates as YYYY-MM-DD and refuses impossible ones", () => {
    expect(normalizeFieldValue(date, "2026-11-19")).toEqual({ ok: true, value: "2026-11-19" });
    expect(normalizeFieldValue(date, " 2026-11-19 ")).toEqual({ ok: true, value: "2026-11-19" });
    expect(normalizeFieldValue(date, "2026-02-30")).toEqual({ ok: false, error: "Enter a real date." });
    expect(normalizeFieldValue(date, "Nov 19")).toEqual({ ok: false, error: "Enter a real date." });
  });

  it("reads numbers with thousands commas and decimals", () => {
    expect(normalizeFieldValue(number, "5,000")).toEqual({ ok: true, value: "5000" });
    expect(normalizeFieldValue(number, "12.5")).toEqual({ ok: true, value: "12.5" });
    expect(normalizeFieldValue(number, "abc")).toEqual({ ok: false, error: "Enter a number." });
    expect(normalizeFieldValue(number, "5,00")).toEqual({ ok: false, error: "Enter a number." });
    expect(normalizeFieldValue(number, "1e6")).toEqual({ ok: false, error: "Enter a number." });
  });

  it("accepts only a listed option", () => {
    expect(normalizeFieldValue(select, "Full program")).toEqual({ ok: true, value: "Full program" });
    expect(normalizeFieldValue(select, "Maybe")).toEqual({ ok: false, error: "Pick one of the listed options." });
  });

  it("keeps text under 500 characters", () => {
    expect(normalizeFieldValue(text, "  Corner office  ")).toEqual({ ok: true, value: "Corner office" });
    expect(normalizeFieldValue(text, "x".repeat(500))).toEqual({ ok: true, value: "x".repeat(500) });
    expect(normalizeFieldValue(text, "x".repeat(501))).toEqual({ ok: false, error: "Keep it under 500 characters." });
  });

  it("treats blank and null as clearing the field", () => {
    for (const field of [date, number, select, text]) {
      expect(normalizeFieldValue(field, "")).toEqual({ ok: true, value: null });
      expect(normalizeFieldValue(field, "   ")).toEqual({ ok: true, value: null });
      expect(normalizeFieldValue(field, null)).toEqual({ ok: true, value: null });
    }
  });
});

describe("setDealField", () => {
  it("refuses a field that does not belong to the deal's pipeline, or to deals at all", async () => {
    const consulting = await setDealField(owner, "d1", "engagement-type", "Start-up", meta, now);
    expect(consulting).toEqual({ ok: false, status: 404, error: "That field is not used on this deal." });

    expect(await setDealField(owner, "d1", "practice-zip", "30301", meta, now)).toMatchObject({ status: 404 });
    expect(await setDealField(owner, "d1", "no-such-field", "x", meta, now)).toMatchObject({ status: 404 });
    expect(writes()).toEqual([]);
  });

  it("goes through the deal edit check first", async () => {
    expect(await setDealField(seesAll, "d1", "target-start-date", "2026-12-01", meta, now)).toEqual({
      ok: false,
      status: 403,
      error: "Only the deal owner or an admin can change this deal.",
    });
    expect(await setDealField({ ...seesAll, seesAllDeals: false }, "d1", "target-start-date", "2026-12-01", meta, now)).toMatchObject({
      status: 404,
      error: "Deal not found.",
    });
    expect(writes()).toEqual([]);
  });

  it("refuses a value of the wrong kind and writes nothing", async () => {
    expect(await setDealField(owner, "d1", "territory-hold-expiry", "2026-02-30", meta, now)).toEqual({
      ok: false,
      status: 400,
      error: "Enter a real date.",
    });
    expect(writes()).toEqual([]);
  });

  it("sets an ordinary date field without touching activities", async () => {
    const result = await setDealField(owner, "d1", "target-start-date", "2026-12-01", meta, now);

    expect(result).toEqual({ ok: true, value: "2026-12-01" });
    expect(db.salesCustomFieldValue.upsert.mock.calls[0][0]).toEqual({
      where: { fieldId_dealId: { fieldId: "f-start", dealId: "d1" } },
      create: { fieldId: "f-start", dealId: "d1", value: "2026-12-01" },
      update: { value: "2026-12-01" },
    });
    expect(db.salesActivity.findMany).not.toHaveBeenCalled();
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesDeal",
        entityId: "d1",
        action: "field_changed",
        actorType: "USER",
        actorId: "r",
        ipAddress: "203.0.113.9",
        before: { fieldKey: "target-start-date", label: "Target Start Date", value: null },
        after: { fieldKey: "target-start-date", label: "Target Start Date", value: "2026-12-01" },
      }),
    ]);
  });

  it("adds a territory hold check 7 days before the expiry, owned by the deal owner", async () => {
    const result = await setDealField(admin, "d1", "territory-hold-expiry", "2026-11-19", meta, now);

    expect(result).toEqual({ ok: true, value: "2026-11-19" });
    expect(db.salesCustomFieldValue.upsert.mock.calls[0][0]).toEqual({
      where: HOLD_KEY,
      create: { fieldId: "f-hold", dealId: "d1", value: "2026-11-19" },
      update: { value: "2026-11-19" },
    });
    expect(db.salesActivity.create.mock.calls[0][0].data).toEqual({
      type: "DEADLINE",
      subject: "Territory hold check",
      dueAt: endOfDay("2026-11-12"),
      hasTime: false,
      ownerId: "r",
      dealId: "d1",
      createdBy: "rule:territory-hold",
    });
    expect(state.audits).toEqual([
      expect.objectContaining({
        action: "field_changed",
        actorType: "USER",
        actorId: "z",
        after: { fieldKey: "territory-hold-expiry", label: "Territory Hold Expiry", value: "2026-11-19" },
      }),
      expect.objectContaining({
        entityType: "SalesDeal",
        entityId: "d1",
        action: "activity_added",
        actorType: "SYSTEM",
        actorId: null,
        ipAddress: null,
        after: {
          activityId: "act-new",
          type: "DEADLINE",
          subject: "Territory hold check",
          dueAt: endOfDay("2026-11-12").toISOString(),
          hasTime: false,
          createdBy: "rule:territory-hold",
        },
      }),
    ]);
  });

  it("moves the open check when the expiry changes", async () => {
    state.values = [{ fieldId: "f-hold", dealId: "d1", value: "2026-11-19" }];
    state.activities = [openCheck, { ...openCheck, id: "a-done", doneAt: new Date("2026-11-01T15:00:00Z") }];
    await setDealField(owner, "d1", "territory-hold-expiry", "2026-12-01", meta, now);

    expect(db.salesActivity.findMany.mock.calls[0][0].where).toEqual({
      dealId: "d1",
      createdBy: "rule:territory-hold",
      doneAt: null,
      archivedAt: null,
    });
    expect(db.salesActivity.updateMany.mock.calls).toEqual([[{ where: { id: { in: ["a-hold"] } }, data: { archivedAt: now } }]]);
    expect(db.salesActivity.create.mock.calls[0][0].data).toMatchObject({ dueAt: endOfDay("2026-11-24") });
    expect(state.audits.map((row) => [row.action, row.actorType])).toEqual([
      ["field_changed", "USER"],
      ["activity_removed", "SYSTEM"],
      ["activity_added", "SYSTEM"],
    ]);
    expect(state.audits[0]).toMatchObject({
      before: { fieldKey: "territory-hold-expiry", label: "Territory Hold Expiry", value: "2026-11-19" },
      after: { fieldKey: "territory-hold-expiry", label: "Territory Hold Expiry", value: "2026-12-01" },
    });
    expect(state.audits[1].before).toEqual({ activityId: "a-hold", type: "DEADLINE", subject: "Territory hold check" });
  });

  it("puts the check on today when 7 days before has already passed", async () => {
    await setDealField(owner, "d1", "territory-hold-expiry", "2026-11-08", meta, now);

    expect(db.salesActivity.create.mock.calls[0][0].data).toMatchObject({ dueAt: endOfDay("2026-11-05") });
  });

  it("clearing the expiry deletes the value and removes the open check", async () => {
    state.values = [{ fieldId: "f-hold", dealId: "d1", value: "2026-11-19" }];
    state.activities = [openCheck];
    const result = await setDealField(owner, "d1", "territory-hold-expiry", null, meta, now);

    expect(result).toEqual({ ok: true, value: null });
    expect(db.salesCustomFieldValue.delete.mock.calls).toEqual([[{ where: HOLD_KEY }]]);
    expect(db.salesCustomFieldValue.upsert).not.toHaveBeenCalled();
    expect(db.salesActivity.updateMany.mock.calls).toEqual([[{ where: { id: { in: ["a-hold"] } }, data: { archivedAt: now } }]]);
    expect(db.salesActivity.create).not.toHaveBeenCalled();
    expect(state.audits.map((row) => row.action)).toEqual(["field_changed", "activity_removed"]);
    expect(state.audits[0].after).toEqual({ fieldKey: "territory-hold-expiry", label: "Territory Hold Expiry", value: null });
  });

  it("writes nothing when the value is unchanged", async () => {
    state.values = [{ fieldId: "f-hold", dealId: "d1", value: "2026-11-19" }];
    state.activities = [openCheck];

    expect(await setDealField(owner, "d1", "territory-hold-expiry", " 2026-11-19 ", meta, now)).toEqual({ ok: true, value: "2026-11-19" });
    expect(await setDealField(owner, "d1", "target-start-date", "", meta, now)).toEqual({ ok: true, value: null });
    expect(writes()).toEqual([]);
  });
});

describe("PUT /api/sales/deals/[dealId]/fields/[fieldKey]", () => {
  const BASE = "http://localhost/api/sales/deals/d1/fields";
  const ctx = (fieldKey: string) => ({ params: Promise.resolve({ dealId: "d1", fieldKey }) });
  const put = (fieldKey: string, body: unknown, headers: Record<string, string> = {}) =>
    fieldRoute.PUT(
      new Request(`${BASE}/${fieldKey}`, {
        method: "PUT",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9, 10.0.0.1", ...headers },
      }),
      ctx(fieldKey),
    );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves the value and answers with what was stored", async () => {
    const res = await put("territory-hold-expiry", { value: "2026-11-19" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: "2026-11-19" });
    expect(state.audits[0]).toMatchObject({ action: "field_changed", ipAddress: "203.0.113.9" });
    expect(db.salesActivity.create.mock.calls[0][0].data).toMatchObject({ dueAt: endOfDay("2026-11-12") });
  });

  it("answers a refusal with its message", async () => {
    const wrongPipeline = await put("engagement-type", { value: "Start-up" });
    expect(wrongPipeline.status).toBe(404);
    expect(await wrongPipeline.json()).toEqual({ error: "That field is not used on this deal." });

    const badDate = await put("territory-hold-expiry", { value: "2026-02-30" });
    expect(badDate.status).toBe(400);
    expect(await badDate.json()).toEqual({ error: "Enter a real date." });
    expect(writes()).toEqual([]);
  });

  it("rejects unknown keys, a missing value and other sites", async () => {
    expect((await put("territory-hold-expiry", { value: "2026-11-19", extra: 1 })).status).toBe(400);
    expect((await put("territory-hold-expiry", {})).status).toBe(400);

    const blocked = await put("territory-hold-expiry", { value: "2026-11-19" }, { origin: "https://evil.example" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "Request blocked." });
    expect(writes()).toEqual([]);
  });

  it("refuses someone without Sales access", async () => {
    const { PermissionError } = await import("@/lib/permissions");
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));

    expect((await put("territory-hold-expiry", { value: "2026-11-19" })).status).toBe(403);
    expect(writes()).toEqual([]);
  });
});
