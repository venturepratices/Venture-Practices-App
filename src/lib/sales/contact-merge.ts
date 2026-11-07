import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canDeleteSalesRecords, type SalesActor } from "@/lib/sales/access";
import { recordSalesAuditMany, type SalesAuditEntry, type SalesRequestMeta } from "@/lib/sales/audit";
import { MERGE_LINKED_MAX } from "@/lib/sales/constants";
import { CONTACT_NOT_FOUND } from "@/lib/sales/contact-access";
import { organizationKeys, personKeys } from "@/lib/sales/contact-keys";
import { contactSnapshot, type ResolvedContacts } from "@/lib/sales/contact-write";
import type { ContactKind } from "@/lib/sales/contacts-query";
import type { DealAuditEvent } from "@/lib/sales/deal-audit";
import { fail, type SalesFail } from "@/lib/sales/http";

// Merging two copies of one person or one practice (Decision 20). Admins only,
// the preview included: its counts span every rep's records. One merge is one
// transaction: read both contacts, refuse anything too big, write the kept
// contact (blank details filled from the dropped one, never overwritten; its
// duplicate keys recomputed), archive the dropped one with `mergedIntoId`, move
// every link to the dropped contact over to the kept one, then write history:
// `merged` on the kept contact, `merged_into` on the dropped one, and one
// `contact_changed` on each deal and lead that moved, all in one insert.
//
// Both contact writes are guarded (their `where` repeats what was read), so a
// merge that loses to an edit or to another merge a moment earlier matches
// nothing. That throws `MergeRaced`, which rolls the whole try back; the merge
// is tried once more in a new transaction, then answers 409.

type Meta = Partial<SalesRequestMeta>;
type MergeDb = Pick<
  typeof prisma,
  "salesPerson" | "salesOrganization" | "salesDeal" | "salesLead" | "salesNote" | "salesActivity"
>;
type ContactName = { id: string; name: string };

const INVALID_INPUT = "Invalid input.";
const ID_MAX = 64;
const ONLY_ADMIN = "Only an admin can merge contacts.";
const PICK_TWO = "Pick two different contacts.";
const TOO_BIG = `This merge would move more than ${MERGE_LINKED_MAX} records. It is too big to do here.`;
export const MERGE_JUST_CHANGED = "One of these contacts just changed. Refresh and try again.";

/** Up to 500 moved rows over the Neon websocket can outlast Prisma's 5-second default. */
const MERGE_TRANSACTION = { timeout: 30_000, maxWait: 5_000 };

/**
 * Every foreign key to a person or an organization, as `model.field`. A test
 * reads them from prisma/schema.prisma, so a new link cannot be missed; each
 * one needs its own entry in the repoint tables below.
 */
export const MERGE_REPOINTS = {
  person: ["salesActivity.personId", "salesDeal.personId", "salesLead.personId", "salesNote.personId"],
  organization: [
    "salesDeal.organizationId",
    "salesLead.organizationId",
    "salesNote.organizationId",
    "salesPerson.organizationId",
  ],
} as const;

export type MergeCounts = { people: number; deals: number; leads: number; notes: number; activities: number };

/** The contact to merge into the one the URL names. */
export const mergeBodySchema = z.strictObject(
  {
    dropId: z
      .string({ error: INVALID_INPUT })
      .min(1, { error: INVALID_INPUT })
      .max(ID_MAX, { error: INVALID_INPUT }),
  },
  { error: INVALID_INPUT },
);

type MergePreview = { ok: true; keep: ContactName; drop: ContactName; counts: MergeCounts } | SalesFail;
type MergeResult = { ok: true; kept: ContactName } | SalesFail;

/** Thrown when a guarded write matched nothing: a contact changed or was merged first. Rolls the transaction back. */
class MergeRaced extends Error {
  constructor() {
    super("A contact changed while it was being merged.");
  }
}

/** A contact that is live and not merged into another one. */
const live = (id: string) => ({ id, archivedAt: null, mergedIntoId: null });

const NAME_SELECT = { id: true, name: true } as const;

async function findName(db: MergeDb, kind: ContactKind, id: string): Promise<ContactName | null> {
  return kind === "person"
    ? db.salesPerson.findFirst({ where: live(id), select: NAME_SELECT })
    : db.salesOrganization.findFirst({ where: live(id), select: NAME_SELECT });
}

/** Every row that points at the dropped contact, archived ones included: all of them move. */
async function countLinked(db: MergeDb, kind: ContactKind, dropId: string): Promise<MergeCounts> {
  if (kind === "person") {
    const where = { personId: dropId };
    const [deals, leads, notes, activities] = await Promise.all([
      db.salesDeal.count({ where }),
      db.salesLead.count({ where }),
      db.salesNote.count({ where }),
      db.salesActivity.count({ where }),
    ]);
    return { people: 0, deals, leads, notes, activities };
  }
  const where = { organizationId: dropId };
  const [people, deals, leads, notes] = await Promise.all([
    db.salesPerson.count({ where }),
    db.salesDeal.count({ where }),
    db.salesLead.count({ where }),
    db.salesNote.count({ where }),
  ]);
  return { people, deals, leads, notes, activities: 0 };
}

const linkedTotal = (counts: MergeCounts) => counts.people + counts.deals + counts.leads + counts.notes + counts.activities;

/**
 * What merging `dropId` into `keepId` would move, for the confirm dialog. Admins
 * only, checked before any read.
 */
export async function loadMergePreview(
  actor: SalesActor,
  kind: ContactKind,
  keepId: string,
  dropId: string,
  db: MergeDb = prisma,
): Promise<MergePreview> {
  if (!canDeleteSalesRecords(actor)) return fail(403, ONLY_ADMIN);
  if (keepId === dropId) return fail(400, PICK_TWO);

  const [keep, drop] = await Promise.all([findName(db, kind, keepId), findName(db, kind, dropId)]);
  if (!keep || !drop) return fail(404, CONTACT_NOT_FOUND);
  return { ok: true, keep, drop, counts: await countLinked(db, kind, dropId) };
}

/**
 * Merges `dropId` into `keepId` (Decision 20). Refuses non-admins (403), the
 * same contact twice (400), a contact that is missing, archived, already merged
 * or of the other kind (404), and a merge that would move more than 500 rows
 * (400). Losing a race twice answers 409. No Undo.
 */
export async function mergeContacts(
  actor: SalesActor,
  kind: ContactKind,
  keepId: string,
  dropId: string,
  meta: Meta,
  now: Date = new Date(),
): Promise<MergeResult> {
  if (!canDeleteSalesRecords(actor)) return fail(403, ONLY_ADMIN);
  if (keepId === dropId) return fail(400, PICK_TWO);

  const attempt = kind === "person" ? mergePeople : mergeOrganizations;
  for (let tries = 0; tries < 2; tries++) {
    try {
      return await prisma.$transaction((tx) => attempt(tx, actor, keepId, dropId, meta, now), MERGE_TRANSACTION);
    } catch (error) {
      if (!(error instanceof MergeRaced)) throw error;
    }
  }
  return fail(409, MERGE_JUST_CHANGED);
}

// --- Shared steps ---

/** Refuses a merge that would move more rows than one transaction should hold. Reads only. */
async function refuseTooBig(tx: Prisma.TransactionClient, kind: ContactKind, dropId: string): Promise<SalesFail | null> {
  return linkedTotal(await countLinked(tx, kind, dropId)) > MERGE_LINKED_MAX ? fail(400, TOO_BIG) : null;
}

/** A guarded write: matching nothing means the row changed after it was read. */
async function guarded(write: Promise<{ count: number }>): Promise<void> {
  const { count } = await write;
  if (count === 0) throw new MergeRaced();
}

const isBlank = (value: string | null) => value === null || value.trim() === "";

/** The dropped contact's value for each field the kept one has blank; a field the kept one has is left out. */
function filledBlanks<F extends string>(
  keep: Record<F, string | null>,
  drop: Record<F, string | null>,
  fields: readonly F[],
): Partial<Record<F, string>> {
  const filled: Partial<Record<F, string>> = {};
  for (const field of fields) {
    const value = drop[field];
    if (isBlank(keep[field]) && value !== null && !isBlank(value)) filled[field] = value;
  }
  return filled;
}

/** A deal's or lead's `contact_changed` row, naming both sides before and after (deal-audit.ts `ContactChange`). */
function contactChangedEntry(
  entityType: "SalesDeal" | "SalesLead",
  entityId: string,
  before: ResolvedContacts,
  after: ResolvedContacts,
): SalesAuditEntry {
  const event: Extract<DealAuditEvent, { action: "contact_changed" }> = {
    action: "contact_changed",
    before: contactSnapshot(before),
    after: { ...contactSnapshot(after), merged: true },
  };
  return { entityType, entityId, ...event };
}

type Repoint = (tx: Prisma.TransactionClient, from: string, to: string) => Promise<unknown>;

const PERSON_REPOINTS: Record<(typeof MERGE_REPOINTS.person)[number], Repoint> = {
  "salesActivity.personId": (tx, from, to) => tx.salesActivity.updateMany({ where: { personId: from }, data: { personId: to } }),
  "salesDeal.personId": (tx, from, to) => tx.salesDeal.updateMany({ where: { personId: from }, data: { personId: to } }),
  "salesLead.personId": (tx, from, to) => tx.salesLead.updateMany({ where: { personId: from }, data: { personId: to } }),
  "salesNote.personId": (tx, from, to) => tx.salesNote.updateMany({ where: { personId: from }, data: { personId: to } }),
};

const ORGANIZATION_REPOINTS: Record<(typeof MERGE_REPOINTS.organization)[number], Repoint> = {
  "salesDeal.organizationId": (tx, from, to) =>
    tx.salesDeal.updateMany({ where: { organizationId: from }, data: { organizationId: to } }),
  "salesLead.organizationId": (tx, from, to) =>
    tx.salesLead.updateMany({ where: { organizationId: from }, data: { organizationId: to } }),
  "salesNote.organizationId": (tx, from, to) =>
    tx.salesNote.updateMany({ where: { organizationId: from }, data: { organizationId: to } }),
  "salesPerson.organizationId": (tx, from, to) =>
    tx.salesPerson.updateMany({ where: { organizationId: from }, data: { organizationId: to } }),
};

// --- People ---

const PERSON_MERGE_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  organizationId: true,
  updatedAt: true,
} satisfies Prisma.SalesPersonSelect;

/** One try at merging two people. The kept person's practice wins when set; deals and leads keep their own. */
async function mergePeople(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  keepId: string,
  dropId: string,
  meta: Meta,
  now: Date,
): Promise<MergeResult> {
  const [keep, drop] = await Promise.all([
    tx.salesPerson.findFirst({ where: live(keepId), select: PERSON_MERGE_SELECT }),
    tx.salesPerson.findFirst({ where: live(dropId), select: PERSON_MERGE_SELECT }),
  ]);
  if (!keep || !drop) return fail(404, CONTACT_NOT_FOUND);
  const tooBig = await refuseTooBig(tx, "person", drop.id);
  if (tooBig) return tooBig;

  // The last check has passed: everything from here writes.
  const filled = filledBlanks(keep, drop, ["email", "phone", "role", "organizationId"] as const);
  const keys = personKeys({ name: keep.name, email: filled.email ?? keep.email, phone: filled.phone ?? keep.phone });
  await guarded(tx.salesPerson.updateMany({ where: { ...live(keep.id), updatedAt: keep.updatedAt }, data: { ...filled, ...keys } }));
  await guarded(tx.salesPerson.updateMany({ where: live(drop.id), data: { archivedAt: now, mergedIntoId: keep.id } }));

  // Read just before the links move, so each history row names the practice the deal or lead has.
  const link = { personId: drop.id };
  const withPractice = { id: true, organization: { select: NAME_SELECT } } as const;
  const [deals, leads] = await Promise.all([
    tx.salesDeal.findMany({ where: link, select: withPractice, take: MERGE_LINKED_MAX }),
    tx.salesLead.findMany({ where: link, select: withPractice, take: MERGE_LINKED_MAX }),
  ]);
  for (const field of MERGE_REPOINTS.person) await PERSON_REPOINTS[field](tx, drop.id, keep.id);

  const moved = (row: { id: string; organization: ContactName | null }, entityType: "SalesDeal" | "SalesLead") =>
    contactChangedEntry(
      entityType,
      row.id,
      { organization: row.organization, person: drop },
      { organization: row.organization, person: keep },
    );
  await recordSalesAuditMany(
    tx,
    actor,
    [
      ...deals.map((deal) => moved(deal, "SalesDeal")),
      ...leads.map((lead) => moved(lead, "SalesLead")),
      {
        entityType: "SalesPerson",
        entityId: keep.id,
        action: "merged",
        after: {
          droppedId: drop.id,
          dropped: {
            name: drop.name,
            email: drop.email,
            phone: drop.phone,
            role: drop.role,
            organizationId: drop.organizationId,
          },
        },
      },
      { entityType: "SalesPerson", entityId: drop.id, action: "merged_into", after: { keptId: keep.id, keptName: keep.name } },
    ],
    meta,
  );
  return { ok: true, kept: { id: keep.id, name: keep.name } };
}

// --- Organizations ---

const ORGANIZATION_MERGE_SELECT = {
  id: true,
  name: true,
  phone: true,
  website: true,
  address: true,
  zip: true,
  updatedAt: true,
} satisfies Prisma.SalesOrganizationSelect;

/** One try at merging two practices. Their people, deals, leads and notes all move to the kept one. */
async function mergeOrganizations(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  keepId: string,
  dropId: string,
  meta: Meta,
  now: Date,
): Promise<MergeResult> {
  const [keep, drop] = await Promise.all([
    tx.salesOrganization.findFirst({ where: live(keepId), select: ORGANIZATION_MERGE_SELECT }),
    tx.salesOrganization.findFirst({ where: live(dropId), select: ORGANIZATION_MERGE_SELECT }),
  ]);
  if (!keep || !drop) return fail(404, CONTACT_NOT_FOUND);
  const tooBig = await refuseTooBig(tx, "organization", drop.id);
  if (tooBig) return tooBig;

  // The last check has passed: everything from here writes.
  const filled = filledBlanks(keep, drop, ["phone", "website", "address", "zip"] as const);
  const keys = organizationKeys({ name: keep.name });
  await guarded(
    tx.salesOrganization.updateMany({ where: { ...live(keep.id), updatedAt: keep.updatedAt }, data: { ...filled, ...keys } }),
  );
  await guarded(tx.salesOrganization.updateMany({ where: live(drop.id), data: { archivedAt: now, mergedIntoId: keep.id } }));

  // Read just before the links move, so each history row names the person the deal or lead has.
  const link = { organizationId: drop.id };
  const withPerson = { id: true, person: { select: NAME_SELECT } } as const;
  const [deals, leads] = await Promise.all([
    tx.salesDeal.findMany({ where: link, select: withPerson, take: MERGE_LINKED_MAX }),
    tx.salesLead.findMany({ where: link, select: withPerson, take: MERGE_LINKED_MAX }),
  ]);
  for (const field of MERGE_REPOINTS.organization) await ORGANIZATION_REPOINTS[field](tx, drop.id, keep.id);

  const moved = (row: { id: string; person: ContactName | null }, entityType: "SalesDeal" | "SalesLead") =>
    contactChangedEntry(
      entityType,
      row.id,
      { organization: drop, person: row.person },
      { organization: keep, person: row.person },
    );
  await recordSalesAuditMany(
    tx,
    actor,
    [
      ...deals.map((deal) => moved(deal, "SalesDeal")),
      ...leads.map((lead) => moved(lead, "SalesLead")),
      {
        entityType: "SalesOrganization",
        entityId: keep.id,
        action: "merged",
        after: {
          droppedId: drop.id,
          dropped: { name: drop.name, phone: drop.phone, website: drop.website, address: drop.address, zip: drop.zip },
        },
      },
      {
        entityType: "SalesOrganization",
        entityId: drop.id,
        action: "merged_into",
        after: { keptId: keep.id, keptName: keep.name },
      },
    ],
    meta,
  );
  return { ok: true, kept: { id: keep.id, name: keep.name } };
}
