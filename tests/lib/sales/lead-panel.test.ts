import { describe, expect, it, vi } from "vitest";

// Who may see and change a lead, its history rows, and what the slide-in lead
// panel shows. The default `prisma` import is mocked only so loading the modules
// stays inert; every loader gets a fake database that records each call.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { loadLeadPanel, LEAD_HIDDEN_FIELD_KEYS } = await import("@/lib/sales/lead-panel");
const { findLeadForEdit, visibleLeadWhere } = await import("@/lib/sales/lead-access");
const { recordLeadAudit } = await import("@/lib/sales/lead-audit");

type SalesActor = import("@/lib/sales/access").SalesActor;
type Row = Record<string, unknown>;
type Args = { where: Row; [key: string]: unknown };

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "a", isAdmin: true, seesAllDeals: true, via: "user" };

const leadRow = (extra: Row = {}) => ({
  id: "l1",
  title: "Oak Creek Dental",
  status: "OPEN",
  source: "Added by hand",
  createdAt: new Date("2026-11-03T14:00:00.000Z"),
  ownerId: "r",
  convertedDealId: null,
  owner: { id: "r", name: "Rachel P." },
  organization: { id: "o1", name: "Oak Creek Dental" },
  person: { id: "p1", name: "Sarah K." },
  ...extra,
});

function fakeDb(opts: { lead?: Row | null; deal?: Row | null; fields?: Row[]; values?: Row[]; activities?: Row[] } = {}) {
  return {
    salesLead: { findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => (opts.lead === undefined ? leadRow() : opts.lead)) },
    salesDeal: { findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.deal ?? null) },
    salesActivity: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.activities ?? []) },
    salesCustomField: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.fields ?? []) },
    salesCustomFieldValue: { findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => opts.values ?? []) },
    teamMember: {
      findMany: vi.fn<(args: Args) => Promise<unknown>>(async () => [
        { id: "b", name: "Ben S." },
        { id: "r", name: "Rachel P." },
      ]),
    },
  };
}

describe("visibleLeadWhere", () => {
  it("is the lead's id, not deleted, and the rep's own unless they see everyone's", () => {
    expect(visibleLeadWhere(rep, "l1")).toEqual({ id: "l1", archivedAt: null, ownerId: "r" });
    expect(visibleLeadWhere(seesAll, "l1")).toEqual({ id: "l1", archivedAt: null });
    expect(visibleLeadWhere(admin, "l1")).toEqual({ id: "l1", archivedAt: null });
  });
});

describe("findLeadForEdit", () => {
  const txWith = (lead: Row | null) => ({ salesLead: { findFirst: vi.fn<(args: Args) => Promise<unknown>>(async () => lead) } });

  it("refuses someone who can see but not change the lead", async () => {
    const tx = txWith({ id: "l1", ownerId: "b" });

    expect(await findLeadForEdit(tx as never, seesAll, "l1", { id: true, ownerId: true })).toEqual({
      ok: false,
      status: 403,
      error: "Only the lead owner or an admin can change this lead.",
    });
    expect(tx.salesLead.findFirst.mock.calls[0][0]).toEqual({
      where: { id: "l1", archivedAt: null },
      select: { id: true, ownerId: true },
    });
  });

  it("answers not found for a lead the person may not see", async () => {
    const tx = txWith(null);

    expect(await findLeadForEdit(tx as never, rep, "l1", { id: true, ownerId: true })).toEqual({
      ok: false,
      status: 404,
      error: "Lead not found.",
    });
    expect(tx.salesLead.findFirst.mock.calls[0][0].where).toEqual({ id: "l1", archivedAt: null, ownerId: "r" });
  });

  it("hands back the lead to its owner and to an admin", async () => {
    const own = await findLeadForEdit(txWith({ id: "l1", ownerId: "r" }) as never, rep, "l1", { id: true, ownerId: true });
    expect(own).toEqual({ ok: true, lead: { id: "l1", ownerId: "r" } });

    const asAdmin = await findLeadForEdit(txWith({ id: "l1", ownerId: "b" }) as never, admin, "l1", { id: true, ownerId: true });
    expect(asAdmin).toEqual({ ok: true, lead: { id: "l1", ownerId: "b" } });
  });
});

describe("recordLeadAudit", () => {
  const txLog = () => ({ salesAuditLog: { create: vi.fn<(args: { data: Row }) => Promise<unknown>>(async () => ({})) } });

  it("writes the row against the lead, with who did it and from where", async () => {
    const tx = txLog();
    await recordLeadAudit(tx as never, rep, "l1", { action: "converted", after: { dealId: "d7" } }, {
      ipAddress: "203.0.113.9",
      userAgent: "Vitest",
    });

    expect(tx.salesAuditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.salesAuditLog.create.mock.calls[0][0].data).toEqual({
      actorType: "USER",
      actorId: "r",
      botTokenId: null,
      entityType: "SalesLead",
      entityId: "l1",
      action: "converted",
      before: undefined,
      after: { dealId: "d7" },
      ipAddress: "203.0.113.9",
      userAgent: "Vitest",
    });
  });

  it("keeps both sides of a change, and none for a refused delete", async () => {
    const tx = txLog();
    await recordLeadAudit(tx as never, admin, "l1", {
      action: "owner_changed",
      before: { ownerId: "r" },
      after: { ownerId: "b", movedActivityIds: ["a1"] },
    });
    await recordLeadAudit(tx as never, rep, "l1", { action: "delete_refused" });

    expect(tx.salesAuditLog.create.mock.calls[0][0].data).toMatchObject({
      entityType: "SalesLead",
      action: "owner_changed",
      before: { ownerId: "r" },
      after: { ownerId: "b", movedActivityIds: ["a1"] },
      ipAddress: null,
      userAgent: null,
    });
    expect(tx.salesAuditLog.create.mock.calls[1][0].data).toMatchObject({
      entityType: "SalesLead",
      action: "delete_refused",
      before: undefined,
      after: undefined,
    });
  });
});

describe("loadLeadPanel", () => {
  it("a deleted or hidden lead is not found", async () => {
    const db = fakeDb({ lead: null });

    expect(await loadLeadPanel(rep, "l1", db as never)).toBeNull();
    expect(db.salesLead.findFirst.mock.calls[0][0].where).toEqual({ id: "l1", archivedAt: null, ownerId: "r" });
    // Nothing else about a lead this person may not see is read.
    expect(db.salesActivity.findMany).not.toHaveBeenCalled();
    expect(db.salesCustomFieldValue.findMany).not.toHaveBeenCalled();

    const asAdmin = fakeDb({ lead: null });
    expect(await loadLeadPanel(admin, "l1", asAdmin as never)).toBeNull();
    expect(asAdmin.salesLead.findFirst.mock.calls[0][0].where).toEqual({ id: "l1", archivedAt: null });
  });

  it("returns the lead, its owner, contacts and the people who can own it", async () => {
    const db = fakeDb();
    const panel = await loadLeadPanel(rep, "l1", db as never);

    expect(panel?.lead).toEqual({
      id: "l1",
      title: "Oak Creek Dental",
      status: "OPEN",
      source: "Added by hand",
      createdAt: "2026-11-03T14:00:00.000Z",
      owner: { id: "r", name: "Rachel P." },
      organization: { id: "o1", name: "Oak Creek Dental" },
      person: { id: "p1", name: "Sarah K." },
    });
    expect(panel?.members).toEqual([
      { id: "b", name: "Ben S." },
      { id: "r", name: "Rachel P." },
    ]);
    expect(panel?.convertedDeal).toBeNull();
    // An open lead has no deal to look up.
    expect(db.salesDeal.findFirst).not.toHaveBeenCalled();
  });

  it("shows the lead's own fields, minus Form Source and Practice Name", async () => {
    const db = fakeDb({
      fields: [
        { id: "f1", key: "practice-zip", label: "Practice ZIP", fieldType: "TEXT", options: [] },
        { id: "f2", key: "best-time", label: "Best time to call", fieldType: "SELECT", options: ["Morning", "Afternoon"] },
      ],
      values: [{ fieldId: "f1", value: "78704" }],
    });
    const panel = await loadLeadPanel(rep, "l1", db as never);

    expect(LEAD_HIDDEN_FIELD_KEYS).toEqual(["form-source", "practice-name"]);
    expect(db.salesCustomField.findMany.mock.calls[0][0]).toMatchObject({
      where: { entity: "LEAD", archivedAt: null, key: { notIn: ["form-source", "practice-name"] } },
      orderBy: { position: "asc" },
    });
    expect(db.salesCustomFieldValue.findMany.mock.calls[0][0].where).toEqual({ leadId: "l1" });
    expect(panel?.fields).toEqual([
      { key: "practice-zip", label: "Practice ZIP", fieldType: "TEXT", options: [], value: "78704" },
      { key: "best-time", label: "Best time to call", fieldType: "SELECT", options: ["Morning", "Afternoon"], value: null },
    ]);
  });

  it("lists the lead's open activities only", async () => {
    const dueAt = new Date("2026-11-05T19:00:00.000Z");
    const db = fakeDb({
      activities: [{ id: "a1", type: "CALL", subject: "First call", dueAt, hasTime: true, createdBy: "r", ownerId: "r" }],
    });
    const panel = await loadLeadPanel(rep, "l1", db as never);

    expect(db.salesActivity.findMany.mock.calls[0][0]).toMatchObject({
      where: { leadId: "l1", dealId: null, doneAt: null, archivedAt: null },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 50,
    });
    expect(db.salesActivity.findMany.mock.calls[0][0].where).toEqual({ leadId: "l1", dealId: null, doneAt: null, archivedAt: null });
    expect(panel?.openActivities).toEqual([
      { id: "a1", type: "CALL", subject: "First call", dueAt: "2026-11-05T19:00:00.000Z", hasTime: true, createdBy: "r", ownerId: "r" },
    ]);
  });

  it.each([
    ["the owner, open", rep, { ownerId: "r", status: "OPEN" }, true, false],
    ["the owner, converted", rep, { ownerId: "r", status: "CONVERTED", convertedDealId: "d7" }, false, false],
    ["the owner, archived", rep, { ownerId: "r", status: "ARCHIVED" }, false, true],
    ["someone who sees everyone's, open", seesAll, { ownerId: "b", owner: { id: "b", name: "Ben S." }, status: "OPEN" }, false, false],
    ["someone who sees everyone's, archived", seesAll, { ownerId: "b", owner: { id: "b", name: "Ben S." }, status: "ARCHIVED" }, false, false],
    ["an admin, open", admin, { ownerId: "b", owner: { id: "b", name: "Ben S." }, status: "OPEN" }, true, false],
    ["an admin, archived", admin, { ownerId: "b", owner: { id: "b", name: "Ben S." }, status: "ARCHIVED" }, false, true],
  ])("only the owner or an admin edits, and never a converted or archived lead: %s", async (_name, actor, extra, canEdit, canRestore) => {
    const panel = await loadLeadPanel(actor, "l1", fakeDb({ lead: leadRow(extra) }) as never);

    expect(panel).toMatchObject({ canEdit, canRestore });
  });

  it("a converted lead names its deal only when the viewer may open it", async () => {
    const converted = leadRow({ status: "CONVERTED", convertedDealId: "d7" });

    const db = fakeDb({ lead: converted, deal: { id: "d7", title: "Oak Creek Dental" } });
    const panel = await loadLeadPanel(rep, "l1", db as never);
    expect(db.salesDeal.findFirst.mock.calls[0][0].where).toEqual({ id: "d7", archivedAt: null, ownerId: "r" });
    expect(panel?.convertedDeal).toEqual({ id: "d7", title: "Oak Creek Dental" });

    const hidden = await loadLeadPanel(rep, "l1", fakeDb({ lead: converted, deal: null }) as never);
    expect(hidden?.convertedDeal).toBeNull();
    expect(hidden?.lead.status).toBe("CONVERTED");
  });
});
