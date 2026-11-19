import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeadIntake } from "@/lib/sales/lead-intake-payload";
import { dateInputValue } from "@/lib/utils";

// Turning a HighLevel opt-in into a lead, against a small fake transaction that
// records every call in order. Checks what is written (and that a repeat writes
// nothing), the lock taken first, the owner's turn taken only for a new lead,
// the first call landing on a business day, the two limits, and the admin alert
// when one trips. Nothing here reaches a real database.

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  auditCount: vi.fn(),
  assignLeadOwner: vi.fn(),
  notificationFind: vi.fn(),
  notificationCreateMany: vi.fn(),
  adminsFind: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    salesAuditLog: { count: mocks.auditCount },
    notification: { findFirst: mocks.notificationFind, createMany: mocks.notificationCreateMany },
    teamMember: { findMany: mocks.adminsFind },
  },
}));
vi.mock("@/lib/sales/lead-assignment", () => ({ assignLeadOwner: mocks.assignLeadOwner }));

import { alertAdminsOfIntakeLimit, createLeadFromIntake, intakeLimitHit } from "@/lib/sales/lead-intake";

type Row = Record<string, unknown>;

const FRIDAY = new Date("2026-11-20T15:00:00Z"); // 10 AM Eastern
const THURSDAY_NIGHT = new Date("2026-11-20T03:00:00Z"); // 10 PM Eastern on Thursday Nov 19
const META = { ipAddress: "203.0.113.9", userAgent: "HighLevel" };

const full: LeadIntake = {
  ghlContactId: "c1",
  personName: "Jane Doe",
  email: "Jane@Example.com",
  phone: "(980) 203-4777",
  practiceName: "Oak Creek Dental",
  practiceZip: "28210",
  formType: "Check Availability",
};

const zipField: Row = { id: "f1", key: "practice-zip", label: "Practice ZIP", fieldType: "TEXT", options: [] };
const existingPerson: Row = { id: "p-existing", name: "Jane Doe", organizationId: "org-old", organization: { id: "org-old", name: "Old Practice" } };

type Fake = {
  activeLead?: Row | null;
  personByEmail?: Row | null;
  personByPhone?: Row | null;
  org?: Row | null;
  zipField?: Row | null;
};

function makeTx(fake: Fake = {}) {
  const calls: string[] = [];
  const locks: string[] = [];
  const audits: Row[] = [];
  const tx = {
    $executeRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push("lock");
      locks.push(String(values[0]));
      return 0;
    }),
    salesLead: {
      findFirst: vi.fn<(args: Row) => Promise<Row | null>>(async () => {
        calls.push("lead.find");
        return fake.activeLead ?? null;
      }),
      create: vi.fn<(args: { data: Row }) => Promise<Row>>(async () => {
        calls.push("lead.create");
        return { id: "lead-1" };
      }),
      update: vi.fn<(args: Row) => Promise<Row>>(async () => {
        calls.push("lead.update");
        return {};
      }),
    },
    salesPerson: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        calls.push("person.find");
        if ("emailKey" in where) return fake.personByEmail ?? null;
        if ("phoneKey" in where) return fake.personByPhone ?? null;
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        calls.push("person.create");
        return { id: "person-1", name: data.name };
      }),
    },
    salesOrganization: {
      findFirst: vi.fn<(args: Row) => Promise<Row | null>>(async () => {
        calls.push("org.find");
        return fake.org ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        calls.push("org.create");
        return { id: "org-1", name: data.name };
      }),
    },
    salesCustomField: { findFirst: vi.fn<(args: Row) => Promise<Row | null>>(async () => ("zipField" in fake ? (fake.zipField ?? null) : null)) },
    salesCustomFieldValue: { upsert: vi.fn<(args: { create: Row }) => Promise<Row>>(async () => ({})) },
    salesActivity: {
      create: vi.fn<(args: { data: Row }) => Promise<Row>>(async () => {
        calls.push("activity.create");
        return { id: "act-1" };
      }),
    },
    salesAuditLog: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        audits.push(data);
        return {};
      }),
    },
  };
  return { tx, calls, locks, audits };
}

async function run(intake: LeadIntake, fake = makeTx(), now = FRIDAY) {
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(fake.tx));
  const result = await createLeadFromIntake(intake, META, now);
  return { result, ...fake };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assignLeadOwner.mockResolvedValue("owner-1");
});

describe("createLeadFromIntake: a new lead", () => {
  it("makes the practice, the person, the lead, the ZIP and the first call, each with a history row from the webhook", async () => {
    const { result, tx, audits } = await run(full, makeTx({ zipField }));

    expect(result).toEqual({ created: true, leadId: "lead-1", ownerId: "owner-1", title: "Oak Creek Dental" });
    expect(tx.salesOrganization.create.mock.calls[0][0].data).toMatchObject({
      name: "Oak Creek Dental",
      ownerId: "owner-1",
      zip: "28210",
      nameKey: "oakcreekdental",
    });
    expect(tx.salesPerson.create.mock.calls[0][0].data).toMatchObject({
      name: "Jane Doe",
      ownerId: "owner-1",
      organizationId: "org-1",
      email: "Jane@Example.com",
      phone: "(980) 203-4777",
      emailKey: "jane@example.com",
      phoneKey: "9802034777",
      nameKey: "janedoe",
    });
    expect(tx.salesLead.create.mock.calls[0][0].data).toMatchObject({
      title: "Oak Creek Dental",
      ownerId: "owner-1",
      source: "Check Availability form",
      organizationId: "org-1",
      personId: "person-1",
      ghlContactId: "c1",
    });
    expect(tx.salesCustomFieldValue.upsert.mock.calls[0][0].create).toEqual({ fieldId: "f1", leadId: "lead-1", value: "28210" });
    expect(tx.salesActivity.create.mock.calls[0][0].data).toMatchObject({
      type: "CALL",
      subject: "Reach out within 1 business day",
      hasTime: false,
      ownerId: "owner-1",
      leadId: "lead-1",
      personId: "person-1",
      createdBy: "webhook:highlevel",
    });

    expect(audits.map((a) => `${a.entityType}:${a.action}`)).toEqual([
      "SalesOrganization:created",
      "SalesPerson:created",
      "SalesLead:created",
      "SalesLead:field_changed",
      "SalesLead:activity_added",
    ]);
    for (const audit of audits) {
      expect(audit).toMatchObject({ actorType: "WEBHOOK", actorId: null, botTokenId: null, ipAddress: "203.0.113.9", userAgent: "HighLevel" });
    }
  });

  it("runs as one transaction with room to finish", async () => {
    await run(full);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ timeout: 20_000 });
  });

  it("takes the lock on every identity before anything else, in a fixed order", async () => {
    const { calls, locks } = await run(full);
    expect(calls.slice(0, 4)).toEqual(["lock", "lock", "lock", "lock"]);
    expect(locks).toEqual(["email:jane@example.com", "ghl:c1", "org:oakcreekdental|28210", "phone:9802034777"]);
    expect(calls[4]).toBe("lead.find");
  });

  it("locks on the practice when that is all there is to go on", async () => {
    const { locks } = await run({ ...full, ghlContactId: null, personName: null, email: null, phone: null });
    expect(locks).toEqual(["org:oakcreekdental|28210"]);
  });

  it("locks on the person's name when nothing else was sent", async () => {
    const { locks } = await run({ ghlContactId: null, personName: "Jo Park", email: null, phone: null, practiceName: null, practiceZip: null, formType: null });
    expect(locks).toEqual(["name:jopark"]);
  });

  it("gives two different people from the same practice the same practice lock, so only one makes it", async () => {
    const first = await run({ ...full, ghlContactId: "c1", email: "a@x.com", phone: null });
    const second = await run({ ...full, ghlContactId: "c2", email: "b@x.com", phone: null });
    expect(first.locks).toContain("org:oakcreekdental|28210");
    expect(second.locks).toContain("org:oakcreekdental|28210");
    expect(first.locks).toEqual([...first.locks].sort());
  });

  it("takes the owner's turn only after it knows the lead is new", async () => {
    const { calls } = await run(full);
    expect(mocks.assignLeadOwner).toHaveBeenCalledTimes(1);
    expect(calls.indexOf("lead.find")).toBeLessThan(calls.indexOf("lead.create"));
  });

  it("makes a lead for a person alone", async () => {
    const { result, tx } = await run({
      ghlContactId: null,
      personName: "Jo Park",
      email: null,
      phone: null,
      practiceName: null,
      practiceZip: null,
      formType: null,
    });
    expect(result).toMatchObject({ created: true, title: "Jo Park" });
    expect(tx.salesOrganization.create).not.toHaveBeenCalled();
    expect(tx.salesOrganization.findFirst).not.toHaveBeenCalled();
    expect(tx.salesPerson.create.mock.calls[0][0].data).toMatchObject({ organizationId: null });
    expect(tx.salesCustomField.findFirst).not.toHaveBeenCalled();
  });

  it("makes a lead for a practice alone", async () => {
    const { result, tx } = await run({ ...full, personName: null, email: null, phone: null, ghlContactId: null });
    expect(result).toMatchObject({ created: true, title: "Oak Creek Dental" });
    expect(tx.salesPerson.findFirst).not.toHaveBeenCalled();
    expect(tx.salesPerson.create).not.toHaveBeenCalled();
    expect(tx.salesLead.create.mock.calls[0][0].data).toMatchObject({ personId: null });
    expect(tx.salesActivity.create.mock.calls[0][0].data).toMatchObject({ personId: null });
  });

  it("leaves the ZIP out, and still makes the lead, when the ZIP field is gone", async () => {
    const { result, tx } = await run(full, makeTx({ zipField: null }));
    expect(result).toMatchObject({ created: true });
    expect(tx.salesCustomFieldValue.upsert).not.toHaveBeenCalled();
  });

  it("sets the Source from the form", async () => {
    const { tx } = await run({ ...full, formType: "Referral form" });
    expect(tx.salesLead.create.mock.calls[0][0].data).toMatchObject({ source: "Referral" });
  });
});

describe("createLeadFromIntake: the first call", () => {
  it("is due the next business day in app time", async () => {
    const thursday = await run(full, makeTx(), THURSDAY_NIGHT);
    expect(dateInputValue(thursday.tx.salesActivity.create.mock.calls[0][0].data.dueAt as Date)).toBe("2026-11-20");
  });

  it("lands on Monday when the lead arrives on a Friday", async () => {
    const friday = await run(full, makeTx(), FRIDAY);
    expect(dateInputValue(friday.tx.salesActivity.create.mock.calls[0][0].data.dueAt as Date)).toBe("2026-11-23");
  });
});

describe("createLeadFromIntake: people and practices that are already there", () => {
  it("finds a person by email first and by phone second", async () => {
    const { tx } = await run(full, makeTx({ personByPhone: existingPerson }));
    expect(tx.salesPerson.findFirst.mock.calls.map((call) => call[0].where)).toEqual([
      { archivedAt: null, mergedIntoId: null, emailKey: "jane@example.com" },
      { archivedAt: null, mergedIntoId: null, phoneKey: "9802034777" },
    ]);
    expect(tx.salesPerson.create).not.toHaveBeenCalled();
    expect(tx.salesLead.create.mock.calls[0][0].data).toMatchObject({ personId: "p-existing" });
  });

  it("stops looking once the email finds someone", async () => {
    const { tx } = await run(full, makeTx({ personByEmail: existingPerson }));
    expect(tx.salesPerson.findFirst).toHaveBeenCalledTimes(1);
  });

  it("finds the practice by name key and ZIP, and does not make another", async () => {
    const { tx, audits } = await run(full, makeTx({ org: { id: "org-found", name: "Oak Creek Dental" } }));
    expect(tx.salesOrganization.findFirst.mock.calls[0][0].where).toEqual({
      archivedAt: null,
      mergedIntoId: null,
      nameKey: "oakcreekdental",
      zip: "28210",
    });
    expect(tx.salesOrganization.create).not.toHaveBeenCalled();
    expect(tx.salesLead.create.mock.calls[0][0].data).toMatchObject({ organizationId: "org-found" });
    expect(audits.map((a) => a.entityType)).not.toContain("SalesOrganization");
  });

  it("uses a found person's own practice when none is sent", async () => {
    const { result, tx } = await run(
      { ...full, practiceName: null, practiceZip: null },
      makeTx({ personByEmail: existingPerson }),
    );
    expect(result).toMatchObject({ title: "Old Practice" });
    expect(tx.salesOrganization.findFirst).not.toHaveBeenCalled();
    expect(tx.salesLead.create.mock.calls[0][0].data).toMatchObject({ organizationId: "org-old", personId: "p-existing" });
  });
});

describe("createLeadFromIntake: a repeat", () => {
  it("writes nothing and does not take the owner's turn when an open lead already has this contact", async () => {
    const { result, tx, audits } = await run(full, makeTx({ activeLead: { id: "lead-9", ghlContactId: "c1" } }));
    expect(result).toEqual({ created: false, leadId: "lead-9" });
    expect(mocks.assignLeadOwner).not.toHaveBeenCalled();
    for (const write of [tx.salesLead.create, tx.salesLead.update, tx.salesPerson.create, tx.salesOrganization.create, tx.salesActivity.create]) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(audits).toEqual([]);
  });

  it("looks for an open, not deleted lead by contact id, person email or person phone", async () => {
    const { tx } = await run(full, makeTx({ activeLead: { id: "lead-9", ghlContactId: "c1" } }));
    expect(tx.salesLead.findFirst.mock.calls[0][0].where).toEqual({
      status: "OPEN",
      archivedAt: null,
      OR: [{ ghlContactId: "c1" }, { person: { emailKey: "jane@example.com" } }, { person: { phoneKey: "9802034777" } }],
    });
  });

  it("finds the open lead by practice name and ZIP when there is no id, email or phone to go on", async () => {
    const { result, tx } = await run(
      { ...full, ghlContactId: null, personName: null, email: null, phone: null },
      makeTx({ activeLead: { id: "lead-9", ghlContactId: null } }),
    );
    expect(result).toEqual({ created: false, leadId: "lead-9" });
    expect(tx.salesLead.findFirst.mock.calls[0][0].where).toEqual({
      status: "OPEN",
      archivedAt: null,
      OR: [{ organization: { nameKey: "oakcreekdental", zip: "28210" } }],
    });
    expect(tx.salesLead.update).not.toHaveBeenCalled();
  });

  it("matches a practice sent without a ZIP only against practices that have none", async () => {
    const { tx } = await run(
      { ...full, ghlContactId: null, personName: null, email: null, phone: null, practiceZip: null },
      makeTx({ activeLead: { id: "lead-9", ghlContactId: null } }),
    );
    expect(tx.salesLead.findFirst.mock.calls[0][0].where).toMatchObject({ OR: [{ organization: { nameKey: "oakcreekdental", zip: null } }] });
  });

  it("finds the open lead by the person's name when only a name was sent", async () => {
    const { result, tx } = await run(
      { ghlContactId: null, personName: "Jo Park", email: null, phone: null, practiceName: null, practiceZip: null, formType: null },
      makeTx({ activeLead: { id: "lead-9", ghlContactId: null } }),
    );
    expect(result).toEqual({ created: false, leadId: "lead-9" });
    expect(tx.salesLead.findFirst.mock.calls[0][0].where).toMatchObject({ OR: [{ person: { nameKey: "jopark" } }] });
  });

  it("does not fall back to names when an id, email or phone was sent", async () => {
    const { tx } = await run({ ...full, email: null, phone: null }, makeTx({ activeLead: { id: "lead-9", ghlContactId: "c1" } }));
    expect(tx.salesLead.findFirst.mock.calls[0][0].where).toMatchObject({ OR: [{ ghlContactId: "c1" }] });
  });

  it("remembers the contact id on an open lead that had none, so the next retry matches it by id", async () => {
    const { tx } = await run(full, makeTx({ activeLead: { id: "lead-9", ghlContactId: null } }));
    expect(tx.salesLead.update).toHaveBeenCalledWith({ where: { id: "lead-9" }, data: { ghlContactId: "c1" } });
  });

  it.each([
    ["it already has another contact id", { id: "lead-9", ghlContactId: "other" }, full],
    ["no contact id was sent", { id: "lead-9", ghlContactId: null }, { ...full, ghlContactId: null }],
  ])("leaves the open lead alone when %s", async (_label, activeLead, intake) => {
    const { tx } = await run(intake, makeTx({ activeLead }));
    expect(tx.salesLead.update).not.toHaveBeenCalled();
  });

  it("goes ahead and makes a lead when nothing open matches (a closed lead does not block a new one)", async () => {
    const { result } = await run(full, makeTx({ activeLead: null }));
    expect(result).toMatchObject({ created: true });
  });
});

describe("intakeLimitHit", () => {
  // The day's count includes the last 10 minutes' leads, so the day count is never below the burst count.
  it.each([
    [0, 0, null],
    [59, 59, null],
    [60, 60, "burst"],
    [5, 299, null],
    [5, 300, "daily"],
    [60, 300, "burst"],
  ])("with %i leads in 10 minutes and %i in a day gives %s", async (burst, daily, expected) => {
    mocks.auditCount.mockImplementation(async ({ where }: { where: { at: { gte: Date } } }) =>
      FRIDAY.getTime() - where.at.gte.getTime() <= 10 * 60_000 ? burst : daily,
    );
    expect(await intakeLimitHit(FRIDAY)).toBe(expected);
  });

  it("counts only leads the webhook made, in the last 10 minutes and in the last day", async () => {
    mocks.auditCount.mockResolvedValue(0);
    await intakeLimitHit(FRIDAY);
    expect(mocks.auditCount.mock.calls.map((call) => call[0].where)).toEqual([
      { actorType: "WEBHOOK", entityType: "SalesLead", action: "created", at: { gte: new Date("2026-11-20T14:50:00Z") } },
      { actorType: "WEBHOOK", entityType: "SalesLead", action: "created", at: { gte: new Date("2026-11-19T15:00:00Z") } },
    ]);
  });
});

describe("alertAdminsOfIntakeLimit", () => {
  beforeEach(() => {
    mocks.notificationFind.mockResolvedValue(null);
    mocks.adminsFind.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    mocks.notificationCreateMany.mockResolvedValue({ count: 2 });
  });

  it("writes one in-app note to every admin, naming the reason", async () => {
    await alertAdminsOfIntakeLimit("burst", FRIDAY);
    const { data } = mocks.notificationCreateMany.mock.calls[0][0];
    expect(data.map((row: Row) => row.recipientId)).toEqual(["a1", "a2"]);
    expect(data[0]).toMatchObject({
      type: "BOT_ALERT",
      entityType: "LeadLink",
      entityId: "burst",
      entityLabel: "HighLevel lead link",
      linkPath: "/sales/leads",
    });
    expect(data[0].message).toMatch(/more than 60 arrived in 10 minutes/);
    expect(data[0].message).not.toContain("—");
    expect(mocks.adminsFind).toHaveBeenCalledWith({ where: { isAdmin: true }, select: { id: true } });
  });

  it("names the day's limit for the daily alert", async () => {
    await alertAdminsOfIntakeLimit("daily", FRIDAY);
    expect(mocks.notificationCreateMany.mock.calls[0][0].data[0].message).toMatch(/more than 300 arrived in one day/);
  });

  it("does not alert again for the same limit within the hour", async () => {
    mocks.notificationFind.mockResolvedValue({ id: "n1" });
    await alertAdminsOfIntakeLimit("burst", FRIDAY);
    expect(mocks.notificationFind.mock.calls[0][0].where).toEqual({
      type: "BOT_ALERT",
      entityType: "LeadLink",
      entityId: "burst",
      createdAt: { gte: new Date("2026-11-20T14:00:00Z") },
    });
    expect(mocks.notificationCreateMany).not.toHaveBeenCalled();
  });

  it("writes nothing when there is no admin", async () => {
    mocks.adminsFind.mockResolvedValue([]);
    await alertAdminsOfIntakeLimit("daily", FRIDAY);
    expect(mocks.notificationCreateMany).not.toHaveBeenCalled();
  });

  it("never throws, even when the database fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.notificationFind.mockRejectedValue(new Error("db down"));
    await expect(alertAdminsOfIntakeLimit("daily", FRIDAY)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
