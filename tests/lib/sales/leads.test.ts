import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Adding a lead by hand, editing it, archiving and restoring it, deleting it
// and setting its fields, through the real routes against a small fake
// database whose delegates record every call, and a fake Sales gate. Checks
// the exact rows written and the locked history rows that go with them, in
// order. Nothing here reaches a real database or a real session.

const requireSalesUserMock = vi.fn();
vi.mock("@/lib/sales/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/access")>();
  return { ...actual, requireSalesUser: () => requireSalesUserMock() };
});
const assignLeadOwnerMock = vi.fn<(tx: unknown) => Promise<string>>();
vi.mock("@/lib/sales/lead-assignment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sales/lead-assignment")>();
  return { ...actual, assignLeadOwner: (tx: unknown) => assignLeadOwnerMock(tx) };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

type Row = Record<string, unknown>;
type Args = { where: Row; data: Row; select?: Row; [key: string]: unknown };
type SalesActor = import("@/lib/sales/access").SalesActor;

const now = new Date("2026-11-05T15:00:00Z");

const rep: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: false, via: "user" };
const seesAll: SalesActor = { userId: "r", isAdmin: false, seesAllDeals: true, via: "user" };
const admin: SalesActor = { userId: "z", isAdmin: true, seesAllDeals: true, via: "user" };

const CRESTVIEW = { id: "o1", name: "Crestview Dental" };
const LAURA = { id: "p1", name: "Laura B." };

/** l1: Crestview Dental, owned by r, open, with its organization and person. */
const baseLead = (extra: Row = {}): Row => ({
  id: "l1",
  title: "Crestview Dental",
  ownerId: "r",
  source: "Referral",
  status: "OPEN",
  archivedAt: null,
  organizationId: "o1",
  personId: "p1",
  organization: CRESTVIEW,
  person: LAURA,
  ...extra,
});

const FIELDS: Row[] = [
  { id: "f-zip", key: "practice-zip", label: "Practice ZIP", entity: "LEAD", fieldType: "TEXT", options: [], archivedAt: null },
  { id: "f-form", key: "form-source", label: "Form Source", entity: "LEAD", fieldType: "TEXT", options: [], archivedAt: null },
  { id: "f-name", key: "practice-name", label: "Practice Name", entity: "LEAD", fieldType: "TEXT", options: [], archivedAt: null },
  { id: "f-hold", key: "territory-hold-expiry", label: "Territory Hold Expiry", entity: "DEAL", fieldType: "DATE", options: [], archivedAt: null },
];

const state = {
  salesMembers: new Set<string>(),
  organizations: [] as Row[],
  people: [] as Row[],
  leads: [] as Row[],
  fields: [] as Row[],
  values: [] as Row[],
  activities: [] as Row[],
  audits: [] as Row[],
  /** Runs before each guarded lead write; answering true makes it match nothing (another request changed the lead first). */
  raceGuardedWrite: null as null | (() => boolean),
};

/** Only the selected keys of a row, like Prisma's `select`. */
const selected = (row: Row, select?: Row) =>
  select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row;

/** Plain equality on every key of `where`, and `{ in: [...] }` lists. */
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) =>
    value !== null && typeof value === "object" && "in" in value
      ? (value.in as unknown[]).includes(row[key])
      : row[key] === value,
  );

/**
 * Whether a contact fixture passes one branch of the see-own `OR`: its owner is
 * the person, or one of its live deals or leads is theirs (`leadOwnerIds`).
 */
const matchesBranch = (row: Row, branch: Row) => {
  if ("ownerId" in branch) return row.ownerId === branch.ownerId;
  const linked = (branch.deals ?? branch.leads) as { some: { ownerId: string; archivedAt: null } };
  const owners = (("deals" in branch ? row.dealOwnerIds : row.leadOwnerIds) ?? []) as string[];
  return linked.some.archivedAt === null && owners.includes(linked.some.ownerId);
};

/** A contact lookup: same id, not archived, and the who-can-see `OR` when there is one. */
const findContact = (rows: Row[], where: Row) => {
  const row = rows.find(
    (r) =>
      r.id === where.id &&
      r.archivedAt === null &&
      (where.OR === undefined || (where.OR as Row[]).some((branch) => matchesBranch(r, branch))),
  );
  return row ? { id: row.id, name: row.name } : null;
};

const findValue = (where: Row) => {
  const key = where.fieldId_leadId as { fieldId: string; leadId: string };
  return state.values.find((v) => v.fieldId === key.fieldId && v.leadId === key.leadId) ?? null;
};

const db = {
  teamMember: {
    findFirst: vi.fn(async (args: Args) => (state.salesMembers.has(args.where.id as string) ? { id: args.where.id } : null)),
  },
  salesOrganization: {
    findFirst: vi.fn(async (args: Args) => findContact(state.organizations, args.where)),
    create: vi.fn(async (args: Args) => selected({ id: "org-new", ...args.data }, args.select)),
  },
  salesPerson: {
    findFirst: vi.fn(async (args: Args) => findContact(state.people, args.where)),
    create: vi.fn(async (args: Args) => selected({ id: "person-new", ...args.data }, args.select)),
  },
  salesLead: {
    findFirst: vi.fn(async (args: Args) => {
      const lead = state.leads.find((row) => matches(row, args.where));
      return lead ? selected(lead, args.select) : null;
    }),
    findMany: vi.fn(async (args: Args) => state.leads.filter((row) => matches(row, args.where)).map((row) => selected(row, args.select))),
    create: vi.fn(async (args: Args) => {
      const lead = { id: "lead-new", status: "OPEN", archivedAt: null, ...args.data };
      state.leads.push(lead);
      return selected(lead, args.select);
    }),
    update: vi.fn(async (args: Args) => {
      const lead = state.leads.find((row) => row.id === args.where.id);
      if (!lead) throw new Error("Record to update not found.");
      Object.assign(lead, args.data);
      return selected(lead, args.select);
    }),
    updateMany: vi.fn(async (args: Args) => {
      if (state.raceGuardedWrite?.()) return { count: 0 };
      const rows = state.leads.filter((row) => matches(row, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    }),
  },
  salesCustomField: {
    findFirst: vi.fn(async (args: Args) => {
      const field = state.fields.find((row) => matches(row, args.where));
      return field ? selected(field, args.select) : null;
    }),
  },
  salesCustomFieldValue: {
    findUnique: vi.fn(async (args: Args) => {
      const value = findValue(args.where);
      return value ? selected(value, args.select) : null;
    }),
    upsert: vi.fn(async (args: Args) => {
      const existing = findValue(args.where);
      if (existing) Object.assign(existing, args.update as Row);
      else state.values.push({ ...(args.create as Row) });
      return {};
    }),
    delete: vi.fn(async (args: Args) => {
      state.values = state.values.filter((value) => value !== findValue(args.where));
      return {};
    }),
  },
  salesActivity: {
    create: vi.fn(async (args: Args) => selected({ id: "act-new", ...args.data }, args.select)),
    findMany: vi.fn(async (args: Args) => state.activities.filter((row) => matches(row, args.where)).map((row) => selected(row, args.select))),
    updateMany: vi.fn(async (args: Args) => {
      const rows = state.activities.filter((row) => matches(row, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    }),
  },
  salesAuditLog: { create: vi.fn(async (args: { data: Row }) => state.audits.push(args.data)) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txClient)),
};
/** What `$transaction` hands its callback: the same delegates, but not the `prisma` object itself. */
const txClient: Row = {};
Object.assign(txClient, db);
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const leadsRoute = await import("@/app/api/sales/leads/route");
const leadRoute = await import("@/app/api/sales/leads/[leadId]/route");
const archiveRoute = await import("@/app/api/sales/leads/[leadId]/archive/route");
const fieldRoute = await import("@/app/api/sales/leads/[leadId]/fields/[fieldKey]/route");
const { PermissionError } = await import("@/lib/permissions");
const { SALES_MEMBER_WHERE } = await import("@/lib/sales/access");
const { endOfDay } = await import("@/lib/utils");

const BASE = "http://localhost/api/sales";
const HEADERS = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
const ctx = (leadId: string) => ({ params: Promise.resolve({ leadId }) });

const post = (body: unknown) =>
  leadsRoute.POST(new Request(`${BASE}/leads`, { method: "POST", body: JSON.stringify(body), headers: HEADERS }));
const patch = (leadId: string, body: unknown) =>
  leadRoute.PATCH(new Request(`${BASE}/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(body), headers: HEADERS }), ctx(leadId));
const del = (leadId: string, headers: Record<string, string> = {}) =>
  leadRoute.DELETE(new Request(`${BASE}/leads/${leadId}`, { method: "DELETE", headers: { ...HEADERS, ...headers } }), ctx(leadId));
const archive = (leadId: string, archived: boolean) =>
  archiveRoute.POST(
    new Request(`${BASE}/leads/${leadId}/archive`, { method: "POST", body: JSON.stringify({ archived }), headers: HEADERS }),
    ctx(leadId),
  );
const putField = (leadId: string, fieldKey: string, value: string | null) =>
  fieldRoute.PUT(
    new Request(`${BASE}/leads/${leadId}/fields/${fieldKey}`, { method: "PUT", body: JSON.stringify({ value }), headers: HEADERS }),
    { params: Promise.resolve({ leadId, fieldKey }) },
  );

const asActor = (actor: SalesActor) => requireSalesUserMock.mockResolvedValue(actor);

/** Every write the fake saw, in the order it happened. */
const writeLog = () =>
  Object.entries({
    "salesOrganization.create": db.salesOrganization.create,
    "salesPerson.create": db.salesPerson.create,
    "salesLead.create": db.salesLead.create,
    "salesLead.update": db.salesLead.update,
    "salesLead.updateMany": db.salesLead.updateMany,
    "salesCustomFieldValue.upsert": db.salesCustomFieldValue.upsert,
    "salesCustomFieldValue.delete": db.salesCustomFieldValue.delete,
    "salesActivity.create": db.salesActivity.create,
    "salesActivity.updateMany": db.salesActivity.updateMany,
    "salesAuditLog.create": db.salesAuditLog.create,
  })
    .flatMap(([name, fn]) => fn.mock.calls.map((call, i) => ({ name, args: call[0] as Row, order: fn.mock.invocationCallOrder[i] })))
    .sort((a, b) => a.order - b.order);
const writeNames = () => writeLog().map((write) => write.name);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  for (const delegate of Object.values(db)) {
    if (typeof delegate === "function") delegate.mockClear();
    else for (const fn of Object.values(delegate)) fn.mockClear();
  }
  state.salesMembers = new Set(["r", "b", "z"]);
  state.organizations = [
    { id: "o1", name: "Crestview Dental", ownerId: "r", archivedAt: null },
    { id: "o2", name: "Bright Smile Dental", ownerId: "r", archivedAt: null },
    { id: "o8", name: "Lakeside Ortho", ownerId: "b", archivedAt: null },
    // Deleted: no one finds it, an admin included.
    { id: "o9", name: "Maple Grove Dental", ownerId: "b", archivedAt: new Date("2026-11-01T15:00:00Z") },
  ];
  state.people = [{ id: "p1", name: "Laura B.", ownerId: "r", archivedAt: null }];
  state.leads = [];
  state.fields = FIELDS.map((field) => ({ ...field }));
  state.values = [];
  state.activities = [];
  state.audits = [];
  state.raceGuardedWrite = null;
  assignLeadOwnerMock.mockReset();
  requireSalesUserMock.mockReset().mockResolvedValue(rep);
});

afterEach(() => {
  vi.useRealTimers();
});

const NEW_LEAD = {
  organization: { name: "Crestview Dental" },
  person: { name: "Laura B." },
  source: "Referral",
  zip: "78704",
  ownerId: "r",
  firstActivity: "call-today",
};

describe("POST /api/sales/leads", () => {
  it("refuses someone without Sales access and writes nothing", async () => {
    requireSalesUserMock.mockRejectedValue(new PermissionError(403, "You don't have access to Sales."));
    const res = await post(NEW_LEAD);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You don't have access to Sales." });
    expect(writeLog()).toEqual([]);
  });

  it("only admins add leads for others", async () => {
    const forSomeoneElse = await post({ ...NEW_LEAD, ownerId: "b" });
    expect(forSomeoneElse.status).toBe(403);
    expect(await forSomeoneElse.json()).toEqual({ error: "You can only add leads for yourself." });

    const sharedOut = await post({ ...NEW_LEAD, ownerId: "auto" });
    expect(sharedOut.status).toBe(403);
    expect(await sharedOut.json()).toEqual({ error: "You can only add leads for yourself." });

    asActor(admin);
    const noAccess = await post({ ...NEW_LEAD, ownerId: "x" });
    expect(noAccess.status).toBe(400);
    expect(await noAccess.json()).toEqual({ error: "Choose a team member with Sales access." });
    expect(db.teamMember.findFirst.mock.calls[0][0]).toMatchObject({ where: { id: "x", ...SALES_MEMBER_WHERE } });

    const noContact = await post({ ...NEW_LEAD, organization: null, person: null });
    expect(noContact.status).toBe(400);
    expect(await noContact.json()).toEqual({ error: "Add a person or an organization." });

    const walkIn = await post({ ...NEW_LEAD, source: "Walk-in" });
    expect(walkIn.status).toBe(400);
    expect(await walkIn.json()).toEqual({ error: "Pick one of the listed sources." });

    expect(assignLeadOwnerMock).not.toHaveBeenCalled();
    expect(writeLog()).toEqual([]);
  });

  it("adds a lead with its contacts, ZIP and first call", async () => {
    const res = await post(NEW_LEAD);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ lead: { id: "lead-new" } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    expect(db.salesOrganization.create.mock.calls[0][0].data).toEqual({ name: "Crestview Dental", ownerId: "r", nameKey: "crestviewdental" });
    expect(db.salesPerson.create.mock.calls[0][0].data).toEqual({
      name: "Laura B.",
      ownerId: "r",
      organizationId: "org-new",
      nameKey: "laurab",
      emailKey: null,
      phoneKey: null,
    });
    expect(db.salesLead.create.mock.calls[0][0].data).toEqual({
      title: "Crestview Dental",
      ownerId: "r",
      source: "Referral",
      organizationId: "org-new",
      personId: "person-new",
    });
    expect(db.salesCustomFieldValue.upsert.mock.calls).toEqual([
      [
        {
          where: { fieldId_leadId: { fieldId: "f-zip", leadId: "lead-new" } },
          create: { fieldId: "f-zip", leadId: "lead-new", value: "78704" },
          update: { value: "78704" },
        },
      ],
    ]);
    expect(db.salesActivity.create.mock.calls[0][0].data).toEqual({
      type: "CALL",
      subject: "First call",
      dueAt: endOfDay("2026-11-05"),
      hasTime: false,
      ownerId: "r",
      leadId: "lead-new",
      personId: "person-new",
      createdBy: "r",
    });

    expect(state.audits.map((row) => [row.entityType, row.entityId, row.action])).toEqual([
      ["SalesOrganization", "org-new", "created"],
      ["SalesPerson", "person-new", "created"],
      ["SalesLead", "lead-new", "created"],
      ["SalesLead", "lead-new", "field_changed"],
      ["SalesLead", "lead-new", "activity_added"],
    ]);
    for (const row of state.audits) {
      expect(row).toMatchObject({ actorType: "USER", actorId: "r", ipAddress: "203.0.113.9" });
    }
    expect(state.audits[2].after).toEqual({
      title: "Crestview Dental",
      ownerId: "r",
      source: "Referral",
      organizationId: "org-new",
      personId: "person-new",
    });
    expect(state.audits[3]).toMatchObject({
      before: { fieldKey: "practice-zip", label: "Practice ZIP", value: null },
      after: { fieldKey: "practice-zip", label: "Practice ZIP", value: "78704" },
    });
    expect(state.audits[4].after).toEqual({
      activityId: "act-new",
      type: "CALL",
      subject: "First call",
      dueAt: endOfDay("2026-11-05").toISOString(),
      hasTime: false,
      createdBy: "r",
    });
  });

  it("shares a lead out automatically for an admin", async () => {
    asActor(admin);
    assignLeadOwnerMock.mockResolvedValue("b");
    const res = await post({ ...NEW_LEAD, ownerId: "auto", firstActivity: "call-tomorrow" });

    expect(res.status).toBe(201);
    expect(assignLeadOwnerMock).toHaveBeenCalledTimes(1);
    expect(assignLeadOwnerMock.mock.calls[0][0]).toBe(txClient);
    // "auto" is not a person: the lead's owner comes from the rotation, so nobody is looked up as "auto".
    expect(db.teamMember.findFirst).not.toHaveBeenCalled();
    expect(db.salesOrganization.create.mock.calls[0][0].data).toMatchObject({ ownerId: "b" });
    expect(db.salesPerson.create.mock.calls[0][0].data).toMatchObject({ ownerId: "b" });
    expect(db.salesLead.create.mock.calls[0][0].data).toMatchObject({ ownerId: "b" });
    expect(db.salesActivity.create.mock.calls[0][0].data).toMatchObject({
      ownerId: "b",
      dueAt: endOfDay("2026-11-06"),
      createdBy: "z",
    });
    expect(state.audits[2]).toMatchObject({ action: "created", actorId: "z", after: { ownerId: "b" } });
  });

  it("a refused new lead uses nobody's turn", async () => {
    asActor(admin);
    assignLeadOwnerMock.mockResolvedValue("b");
    const res = await post({ ...NEW_LEAD, ownerId: "auto", organization: { id: "o9" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That organization was not found." });
    expect(assignLeadOwnerMock).not.toHaveBeenCalled();
    expect(writeLog()).toEqual([]);
  });

  it("names a lead after its person when there is no organization, and defaults the source", async () => {
    const res = await post({ person: { name: "Laura B." }, ownerId: "r", firstActivity: "demo-2-days" });

    expect(res.status).toBe(201);
    expect(db.salesOrganization.create).not.toHaveBeenCalled();
    expect(db.salesLead.create.mock.calls[0][0].data).toEqual({
      title: "Laura B.",
      ownerId: "r",
      source: "Added by hand",
      organizationId: null,
      personId: "person-new",
    });
    // No ZIP was given, so no value row and no field history.
    expect(db.salesCustomFieldValue.upsert).not.toHaveBeenCalled();
    expect(db.salesActivity.create.mock.calls[0][0].data).toMatchObject({ type: "MEETING", subject: "Demo", dueAt: endOfDay("2026-11-07") });
    expect(state.audits.map((row) => row.action)).toEqual(["created", "created", "activity_added"]);
  });

  it("uses a picked organization and skips the ZIP when the Practice ZIP field is gone", async () => {
    state.fields = state.fields.map((field) => (field.key === "practice-zip" ? { ...field, archivedAt: now } : field));
    const res = await post({ ...NEW_LEAD, organization: { id: "o2" }, person: null });

    expect(res.status).toBe(201);
    expect(db.salesOrganization.create).not.toHaveBeenCalled();
    expect(db.salesLead.create.mock.calls[0][0].data).toEqual({
      title: "Bright Smile Dental",
      ownerId: "r",
      source: "Referral",
      organizationId: "o2",
      personId: null,
    });
    expect(db.salesCustomFieldValue.upsert).not.toHaveBeenCalled();
    expect(db.salesActivity.create.mock.calls[0][0].data).toMatchObject({ personId: null });
    expect(state.audits.map((row) => row.action)).toEqual(["created", "activity_added"]);
  });
});

describe("PATCH /api/sales/leads/[leadId]", () => {
  it("moves the old owner's open activities with the lead", async () => {
    state.leads = [baseLead()];
    state.activities = [
      { id: "a1", leadId: "l1", dealId: null, ownerId: "r", doneAt: null, archivedAt: null },
      { id: "a2", leadId: "l1", dealId: null, ownerId: "z", doneAt: null, archivedAt: null },
      { id: "a3", leadId: "l1", dealId: null, ownerId: "r", doneAt: new Date("2026-11-04T15:00:00Z"), archivedAt: null },
    ];
    const res = await patch("l1", { ownerId: "b" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lead: { id: "l1", title: "Crestview Dental", source: "Referral", ownerId: "b", organizationId: "o1", personId: "p1" },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(writeLog()[0]).toMatchObject({
      name: "salesLead.updateMany",
      args: { where: { id: "l1", ownerId: "r", status: "OPEN", archivedAt: null }, data: { ownerId: "b" } },
    });
    expect(db.salesLead.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "l1", ownerId: "r", status: "OPEN", archivedAt: null },
      data: { ownerId: "b" },
    });
    expect(db.salesActivity.findMany.mock.calls[0][0].where).toEqual({
      leadId: "l1",
      dealId: null,
      ownerId: "r",
      doneAt: null,
      archivedAt: null,
    });
    expect(db.salesActivity.updateMany.mock.calls).toEqual([
      [{ where: { id: { in: ["a1"] }, dealId: null, ownerId: "r" }, data: { ownerId: "b" } }],
    ]);
    expect(db.salesLead.update).not.toHaveBeenCalled();
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesLead",
        entityId: "l1",
        action: "owner_changed",
        before: { ownerId: "r" },
        after: { ownerId: "b", movedActivityIds: ["a1"] },
        ipAddress: "203.0.113.9",
      }),
    ]);
  });

  it("answers 409 when the lead keeps changing under the owner change", async () => {
    state.leads = [baseLead()];
    state.raceGuardedWrite = () => true;
    const res = await patch("l1", { ownerId: "b" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This lead just changed. Refresh and try again." });
    expect(db.salesLead.findFirst).toHaveBeenCalledTimes(2);
    expect(writeNames()).toEqual(["salesLead.updateMany", "salesLead.updateMany"]);
    expect(state.audits).toEqual([]);
  });

  it("refuses an owner change that lost to an admin giving the lead away", async () => {
    asActor(seesAll);
    state.leads = [baseLead()];
    state.activities = [{ id: "a1", leadId: "l1", dealId: null, ownerId: "r", doneAt: null, archivedAt: null }];
    // An admin gives the lead to z between this request's read and its write.
    state.raceGuardedWrite = () => {
      state.leads[0].ownerId = "z";
      state.raceGuardedWrite = null;
      return true;
    };
    const res = await patch("l1", { ownerId: "b" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the lead owner or an admin can change this lead." });
    expect(writeNames()).toEqual(["salesLead.updateMany"]);
    expect(state.leads[0].ownerId).toBe("z");
    expect(state.activities[0].ownerId).toBe("r");
    expect(state.audits).toEqual([]);
  });

  it("refuses edits from people who may not make them", async () => {
    // Someone who sees every lead but does not own this one.
    asActor(seesAll);
    state.leads = [baseLead({ ownerId: "b" })];
    for (const res of [await patch("l1", { title: "Oak" }), await archive("l1", true), await putField("l1", "practice-zip", "78704")]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Only the lead owner or an admin can change this lead." });
    }

    // Someone who sees only their own leads.
    asActor(rep);
    for (const res of [await patch("l1", { title: "Oak" }), await archive("l1", true), await putField("l1", "practice-zip", "78704")]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Lead not found." });
    }

    state.leads = [baseLead({ status: "CONVERTED" })];
    for (const res of [await patch("l1", { title: "Oak" }), await archive("l1", true), await putField("l1", "practice-zip", "78704")]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "This lead was converted. Open its deal instead." });
    }

    state.leads = [baseLead({ status: "ARCHIVED" })];
    for (const res of [await patch("l1", { title: "Oak" }), await putField("l1", "practice-zip", "78704")]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "This lead is archived. Restore it first." });
    }

    state.leads = [baseLead()];
    const noAccess = await patch("l1", { ownerId: "x" });
    expect(noAccess.status).toBe(400);
    expect(await noAccess.json()).toEqual({ error: "Choose a team member with Sales access." });

    const hiddenOrganization = await patch("l1", { organization: { id: "o8" } });
    expect(hiddenOrganization.status).toBe(400);
    expect(await hiddenOrganization.json()).toEqual({ error: "That organization was not found." });

    expect(writeLog()).toEqual([]);
  });

  it("a title-only edit leaves the contacts alone", async () => {
    state.leads = [baseLead()];
    const res = await patch("l1", { title: "  Crestview Family Dental " });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lead: { id: "l1", title: "Crestview Family Dental", source: "Referral", ownerId: "r", organizationId: "o1", personId: "p1" },
    });
    expect(db.salesLead.update.mock.calls).toHaveLength(1);
    expect(db.salesLead.update.mock.calls[0][0]).toMatchObject({ where: { id: "l1" } });
    expect(db.salesLead.update.mock.calls[0][0].data).toEqual({ title: "Crestview Family Dental" });
    expect(state.audits).toEqual([
      expect.objectContaining({
        action: "updated",
        before: { title: "Crestview Dental" },
        after: { title: "Crestview Family Dental" },
        ipAddress: "203.0.113.9",
      }),
    ]);
  });

  it("changes a lead's contacts with a readable history row", async () => {
    state.leads = [baseLead()];
    const res = await patch("l1", { organization: { id: "o2" } });

    expect(res.status).toBe(200);
    expect((await res.json()).lead).toMatchObject({ organizationId: "o2", personId: "p1" });
    expect(db.salesLead.update.mock.calls[0][0].data).toEqual({ organizationId: "o2" });
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesLead",
        entityId: "l1",
        action: "contact_changed",
        before: { organizationId: "o1", organizationName: "Crestview Dental", personId: "p1", personName: "Laura B." },
        after: { organizationId: "o2", organizationName: "Bright Smile Dental", personId: "p1", personName: "Laura B." },
      }),
    ]);

    state.leads = [baseLead()];
    state.audits = [];
    const cleared = await patch("l1", { person: null });

    expect(cleared.status).toBe(200);
    expect(db.salesLead.update.mock.calls[1][0].data).toEqual({ personId: null });
    expect(state.audits).toEqual([
      expect.objectContaining({
        action: "contact_changed",
        before: { organizationId: "o1", organizationName: "Crestview Dental", personId: "p1", personName: "Laura B." },
        after: { organizationId: "o1", organizationName: "Crestview Dental", personId: null, personName: null },
      }),
    ]);
  });

  it("adds a new person to the lead's organization, for the lead's owner", async () => {
    state.leads = [baseLead({ personId: null, person: null })];
    const res = await patch("l1", { person: { name: "Mark T." } });

    expect(res.status).toBe(200);
    expect(db.salesPerson.create.mock.calls[0][0].data).toEqual({
      name: "Mark T.",
      ownerId: "r",
      organizationId: "o1",
      nameKey: "markt",
      emailKey: null,
      phoneKey: null,
    });
    expect(db.salesLead.update.mock.calls[0][0].data).toEqual({ personId: "person-new" });
    expect(state.audits.map((row) => [row.entityType, row.action])).toEqual([
      ["SalesPerson", "created"],
      ["SalesLead", "contact_changed"],
    ]);
    expect(state.audits[1].after).toEqual({
      organizationId: "o1",
      organizationName: "Crestview Dental",
      personId: "person-new",
      personName: "Mark T.",
    });
  });

  it("a change that changes nothing writes nothing", async () => {
    state.leads = [baseLead()];

    const same = await patch("l1", { title: "Crestview Dental", ownerId: "r", source: "Referral", organization: { id: "o1" } });
    expect(same.status).toBe(200);
    expect((await same.json()).lead).toEqual({
      id: "l1",
      title: "Crestview Dental",
      source: "Referral",
      ownerId: "r",
      organizationId: "o1",
      personId: "p1",
    });

    const colour = await patch("l1", { colour: "red" });
    expect(colour.status).toBe(400);

    const empty = await patch("l1", {});
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Nothing to change." });

    const blank = await patch("l1", { title: "   " });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: "Give the lead a name." });

    const long = await patch("l1", { title: "x".repeat(201) });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: "Keep the name under 200 characters." });

    const walkIn = await patch("l1", { source: "Walk-in" });
    expect(walkIn.status).toBe(400);
    expect(await walkIn.json()).toEqual({ error: "Pick one of the listed sources." });

    expect(writeLog()).toEqual([]);
  });
});

describe("POST /api/sales/leads/[leadId]/archive", () => {
  it("archives with a way back", async () => {
    state.leads = [baseLead()];

    const archived = await archive("l1", true);
    expect(archived.status).toBe(200);
    expect(await archived.json()).toEqual({ ok: true, changed: true });
    expect(db.salesLead.updateMany.mock.calls).toEqual([
      [{ where: { id: "l1", status: "OPEN", archivedAt: null, ownerId: "r" }, data: { status: "ARCHIVED" } }],
    ]);
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesLead",
        entityId: "l1",
        action: "status_changed",
        before: { status: "OPEN" },
        after: { status: "ARCHIVED" },
        ipAddress: "203.0.113.9",
      }),
    ]);

    const again = await archive("l1", true);
    expect(await again.json()).toEqual({ ok: true, changed: false });
    expect(db.salesLead.updateMany).toHaveBeenCalledTimes(1);
    expect(state.audits).toHaveLength(1);

    const restored = await archive("l1", false);
    expect(await restored.json()).toEqual({ ok: true, changed: true });
    expect(db.salesLead.updateMany.mock.calls[1][0]).toEqual({
      where: { id: "l1", status: "ARCHIVED", archivedAt: null, ownerId: "r" },
      data: { status: "OPEN" },
    });
    expect(state.audits[1]).toMatchObject({ action: "status_changed", before: { status: "ARCHIVED" }, after: { status: "OPEN" } });
    expect(state.leads[0]).toMatchObject({ status: "OPEN", archivedAt: null });
  });

  it("answers 409 when the lead keeps changing under the archive", async () => {
    state.leads = [baseLead()];
    state.raceGuardedWrite = () => true;
    const res = await archive("l1", true);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This lead just changed. Refresh and try again." });
    expect(state.audits).toEqual([]);
  });

  it("needs a true or false", async () => {
    state.leads = [baseLead()];
    const res = await archiveRoute.POST(
      new Request(`${BASE}/leads/l1/archive`, { method: "POST", body: JSON.stringify({ archived: "yes" }), headers: HEADERS }),
      ctx("l1"),
    );

    expect(res.status).toBe(400);
    expect(writeLog()).toEqual([]);
  });
});

describe("DELETE /api/sales/leads/[leadId]", () => {
  it("deleting is for admins, and attempts are logged", async () => {
    state.leads = [baseLead()];
    const refused = await del("l1");

    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Only an admin can delete leads." });
    expect(writeNames()).toEqual(["salesAuditLog.create"]);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      entityType: "SalesLead",
      entityId: "l1",
      action: "delete_refused",
      actorType: "USER",
      actorId: "r",
      ipAddress: "203.0.113.9",
    });
    expect(state.audits[0].before).toBeUndefined();
    expect(state.audits[0].after).toBeUndefined();

    // A lead they cannot see: not found, and no row, so made-up ids cannot fill the log.
    state.leads = [baseLead({ ownerId: "b" })];
    state.audits = [];
    const hidden = await del("l1");
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Lead not found." });
    expect(state.audits).toEqual([]);

    asActor(admin);
    const deleted = await del("l1");
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect(state.leads[0].archivedAt).toEqual(now);
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesLead",
        entityId: "l1",
        action: "archived",
        actorId: "z",
        before: { archivedAt: null },
        after: { archivedAt: "2026-11-05T15:00:00.000Z" },
        ipAddress: "203.0.113.9",
      }),
    ]);
  });

  it("blocks a delete sent from another site, even for an admin", async () => {
    state.leads = [baseLead()];
    asActor(admin);
    const res = await del("l1", { origin: "https://evil.example" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Request blocked." });
    expect(db.salesLead.findFirst).not.toHaveBeenCalled();
    expect(writeLog()).toEqual([]);
  });
});

describe("PUT /api/sales/leads/[leadId]/fields/[fieldKey]", () => {
  it("sets a lead field", async () => {
    state.leads = [baseLead()];

    const set = await putField("l1", "practice-zip", " 78704 ");
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ value: "78704" });
    expect(db.salesCustomFieldValue.upsert.mock.calls).toEqual([
      [
        {
          where: { fieldId_leadId: { fieldId: "f-zip", leadId: "l1" } },
          create: { fieldId: "f-zip", leadId: "l1", value: "78704" },
          update: { value: "78704" },
        },
      ],
    ]);
    expect(state.audits).toEqual([
      expect.objectContaining({
        entityType: "SalesLead",
        entityId: "l1",
        action: "field_changed",
        before: { fieldKey: "practice-zip", label: "Practice ZIP", value: null },
        after: { fieldKey: "practice-zip", label: "Practice ZIP", value: "78704" },
        ipAddress: "203.0.113.9",
      }),
    ]);

    // The same value again changes nothing.
    const same = await putField("l1", "practice-zip", "78704");
    expect(await same.json()).toEqual({ value: "78704" });
    expect(state.audits).toHaveLength(1);

    const cleared = await putField("l1", "practice-zip", null);
    expect(await cleared.json()).toEqual({ value: null });
    expect(db.salesCustomFieldValue.delete.mock.calls).toEqual([[{ where: { fieldId_leadId: { fieldId: "f-zip", leadId: "l1" } } }]]);
    expect(state.values).toEqual([]);
    expect(state.audits[1]).toMatchObject({
      action: "field_changed",
      before: { fieldKey: "practice-zip", label: "Practice ZIP", value: "78704" },
      after: { fieldKey: "practice-zip", label: "Practice ZIP", value: null },
    });
  });

  it("refuses fields that are not used on leads", async () => {
    state.leads = [baseLead()];
    for (const key of ["form-source", "practice-name", "territory-hold-expiry", "no-such-field"]) {
      const res = await putField("l1", key, "x");
      expect(res.status, key).toBe(404);
      expect(await res.json()).toEqual({ error: "That field is not used on leads." });
    }
    expect(writeLog()).toEqual([]);
  });
});
