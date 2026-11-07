import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import type { SalesLeadStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { canDeleteSalesRecords, SALES_MEMBER_WHERE, type SalesActor } from "@/lib/sales/access";
import { auditDiff, type SalesRequestMeta } from "@/lib/sales/audit";
import {
  DEAL_SOURCES,
  FIRST_ACTIVITY_PRESETS,
  HAND_MADE_SOURCE,
  PRACTICE_ZIP_FIELD_KEY,
  TITLE_MAX,
} from "@/lib/sales/constants";
import {
  checkContactRefs,
  contactRefSchema,
  createContacts,
  type ContactRef,
  type ResolvedContacts,
} from "@/lib/sales/contact-write";
import { normalizeFieldValue, type CustomFieldShape } from "@/lib/sales/custom-fields";
import type { ContactChange } from "@/lib/sales/deal-audit";
import { activityDueAt } from "@/lib/sales/format";
import { fail, type SalesFail } from "@/lib/sales/http";
import { findLeadForEdit, LEAD_ARCHIVED, LEAD_CONVERTED, LEAD_NOT_FOUND, visibleLeadWhere } from "@/lib/sales/lead-access";
import { assignLeadOwner } from "@/lib/sales/lead-assignment";
import { recordLeadAudit } from "@/lib/sales/lead-audit";
import { LEAD_HIDDEN_FIELD_KEYS } from "@/lib/sales/lead-panel";
import { addDaysToDateString, dateInputValue } from "@/lib/utils";

// Adding a lead by hand, editing it, archiving and restoring it, deleting it,
// and setting its fields. Each change runs in one transaction with its history
// rows. Every check that can refuse runs before the first write: a refusal is
// returned from the transaction (which then commits), so nothing may have been
// written by then. A converted or archived lead is read-only (Decision 5).
//
// A change of owner, an archive and a restore land only on the lead exactly as
// it was checked: the write's `where` repeats the owner and status it read, so
// a lead converted or given away a moment earlier matches nothing, and the
// change is decided again on a fresh read (see `retryIfRaced`).

type Meta = Partial<SalesRequestMeta>;

const ONLY_YOURSELF = "You can only add leads for yourself.";
const NEED_CONTACT = "Add a person or an organization.";
const PICK_SOURCE = "Pick one of the listed sources.";
const LEAD_JUST_CHANGED = "This lead just changed. Refresh and try again.";
const FIELD_NOT_USED = "That field is not used on leads.";

export const CHOOSE_SALES_MEMBER = "Choose a team member with Sales access.";
export const ONLY_ADMIN_DELETES_LEADS = "Only an admin can delete leads.";

/** The Owner choice that shares a new lead out the way Sales settings say (admins only). */
const AUTO_OWNER = "auto";
const ID_MAX = 64;
const ZIP_MAX = 20;

/** What an attempt answers when its guarded lead write matched nothing: another request changed the lead first. */
const RACED = Symbol("raced");

/**
 * Runs an attempt, and once more when it lost a race. The guarded write is the
 * attempt's first write, so an attempt that lost wrote nothing, and the second
 * one reads the lead again (each statement sees what has committed by then): a
 * lead given to someone else is refused as not yours, a converted one as
 * converted. Losing twice answers 409.
 */
async function retryIfRaced<T>(attempt: () => Promise<T | typeof RACED>): Promise<T | SalesFail> {
  for (let tries = 0; tries < 2; tries++) {
    const result = await attempt();
    if (result !== RACED) return result;
  }
  return fail(409, LEAD_JUST_CHANGED);
}

/** A converted or archived lead takes no change but Restore and an admin's Delete. */
function refuseUnlessOpen(status: SalesLeadStatus): SalesFail | null {
  if (status === "CONVERTED") return fail(409, LEAD_CONVERTED);
  if (status === "ARCHIVED") return fail(409, LEAD_ARCHIVED);
  return null;
}

// --- Input ---

const FIRST_ACTIVITY_IDS = ["call-today", "call-tomorrow", "demo-2-days"] as const satisfies readonly (keyof typeof FIRST_ACTIVITY_PRESETS)[];

const ownerIdSchema = z
  .string({ error: CHOOSE_SALES_MEMBER })
  .min(1, { error: CHOOSE_SALES_MEMBER })
  .max(ID_MAX, { error: CHOOSE_SALES_MEMBER });
const sourceSchema = z.enum(DEAL_SOURCES, { error: PICK_SOURCE });

export const createLeadSchema = z.strictObject({
  organization: contactRefSchema.default(null),
  person: contactRefSchema.default(null),
  source: sourceSchema.default(HAND_MADE_SOURCE),
  zip: z.string().trim().max(ZIP_MAX, { error: "Keep the ZIP under 20 characters." }).optional(),
  /** A Sales member's id, or "auto" (admins) to share the lead out the way Sales settings say. */
  ownerId: ownerIdSchema,
  firstActivity: z.enum(FIRST_ACTIVITY_IDS, { error: "Pick a first activity." }),
});

/** A key left out stays out (no defaults here): only the keys sent are changed. */
export const updateLeadSchema = z
  .strictObject({
    title: z
      .string()
      .trim()
      .min(1, { error: "Give the lead a name." })
      .max(TITLE_MAX, { error: "Keep the name under 200 characters." })
      .optional(),
    source: sourceSchema.optional(),
    ownerId: ownerIdSchema.optional(),
    organization: contactRefSchema.optional(),
    person: contactRefSchema.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), { error: "Nothing to change." });

/** The archive route's body: true archives, false restores. */
export const leadArchiveSchema = z.strictObject({ archived: z.boolean({ error: "Invalid input." }) });

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

// --- Custom field values ---

const LEAD_FIELD_SELECT = { id: true, key: true, label: true, fieldType: true, options: true } as const;
type LeadField = { id: string; key: string; label: string } & CustomFieldShape;

/**
 * Sets (or with null, clears) one field's value on a lead, with its
 * `field_changed` row. The caller has already checked the value and that it
 * differs from `previous`.
 */
async function writeLeadField(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  leadId: string,
  field: LeadField,
  previous: string | null,
  next: string | null,
  meta: Meta,
): Promise<void> {
  const where = { fieldId_leadId: { fieldId: field.id, leadId } };
  if (next === null) {
    await tx.salesCustomFieldValue.delete({ where });
  } else {
    await tx.salesCustomFieldValue.upsert({ where, create: { fieldId: field.id, leadId, value: next }, update: { value: next } });
  }
  await recordLeadAudit(
    tx,
    actor,
    leadId,
    {
      action: "field_changed",
      before: { fieldKey: field.key, label: field.label, value: previous },
      after: { fieldKey: field.key, label: field.label, value: next },
    },
    meta,
  );
}

// --- Add ---

type CreateLeadResult = { ok: true; lead: { id: string } } | SalesFail;

/**
 * Adds a lead by hand (Decision 7): its organization and person (picked or
 * new, at least one), its Source, its Practice ZIP and its first activity
 * (spec rule 1), all owned by the lead owner. The lead is named after the
 * organization, else the person. Only an admin may add a lead for someone else
 * or share it out ("auto"); the rotation's turn is taken only once every check
 * has passed, so a refused lead uses nobody's turn.
 */
export async function createLead(
  actor: SalesActor,
  input: CreateLeadInput,
  meta: Meta,
  now: Date,
): Promise<CreateLeadResult> {
  const auto = input.ownerId === AUTO_OWNER;
  if (!actor.isAdmin && input.ownerId !== actor.userId) return fail(403, ONLY_YOURSELF);
  const contactInput = { organization: input.organization, person: input.person };
  if (!contactInput.organization && !contactInput.person) return fail(400, NEED_CONTACT);

  return prisma.$transaction(async (tx): Promise<CreateLeadResult> => {
    if (!auto) {
      const owner = await tx.teamMember.findFirst({ where: { id: input.ownerId, ...SALES_MEMBER_WHERE }, select: { id: true } });
      if (!owner) return fail(400, CHOOSE_SALES_MEMBER);
    }

    const checked = await checkContactRefs(tx, actor, contactInput);
    if (!checked.ok) return checked;

    // The ZIP lives in the Practice ZIP lead field; with that field gone, it is
    // left out rather than refusing the lead.
    let zip: { field: LeadField; value: string } | null = null;
    if (input.zip) {
      const field = await tx.salesCustomField.findFirst({
        where: { key: PRACTICE_ZIP_FIELD_KEY, entity: "LEAD", archivedAt: null },
        select: LEAD_FIELD_SELECT,
      });
      if (field) {
        const normalized = normalizeFieldValue(field, input.zip);
        if (!normalized.ok) return fail(400, normalized.error);
        if (normalized.value !== null) zip = { field, value: normalized.value };
      }
    }

    // Every check has passed. From here on everything writes, starting with the
    // rotation's turn when the lead is shared out.
    const ownerId = auto ? await assignLeadOwner(tx) : input.ownerId;
    const { organization, person } = await createContacts(tx, actor, contactInput, checked.picked, ownerId, meta);

    const fields = {
      // Named after the practice when there is one, else the person.
      title: (organization?.name ?? person?.name ?? "").slice(0, TITLE_MAX),
      ownerId,
      source: input.source,
      organizationId: organization?.id ?? null,
      personId: person?.id ?? null,
    };
    const lead = await tx.salesLead.create({ data: fields, select: { id: true } });
    await recordLeadAudit(tx, actor, lead.id, { action: "created", after: fields }, meta);

    if (zip) await writeLeadField(tx, actor, lead.id, zip.field, null, zip.value, meta);

    const preset = FIRST_ACTIVITY_PRESETS[input.firstActivity];
    const dueAt = activityDueAt(addDaysToDateString(dateInputValue(now), preset.offsetDays), null);
    const activity = await tx.salesActivity.create({
      data: {
        type: preset.type,
        subject: preset.subject,
        dueAt,
        hasTime: false,
        ownerId,
        leadId: lead.id,
        personId: person?.id ?? null,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await recordLeadAudit(
      tx,
      actor,
      lead.id,
      {
        action: "activity_added",
        after: {
          activityId: activity.id,
          type: preset.type,
          subject: preset.subject,
          dueAt: dueAt.toISOString(),
          hasTime: false,
          createdBy: actor.userId,
        },
      },
      meta,
    );

    return { ok: true, lead: { id: lead.id } };
  });
}

// --- Edit ---

const EDIT_LEAD_SELECT = {
  id: true,
  title: true,
  source: true,
  ownerId: true,
  status: true,
  organizationId: true,
  personId: true,
  organization: { select: { id: true, name: true } },
  person: { select: { id: true, name: true } },
} satisfies Prisma.SalesLeadSelect;

type EditedLead = {
  id: string;
  title: string;
  source: string;
  ownerId: string;
  organizationId: string | null;
  personId: string | null;
};
type UpdateLeadResult = { ok: true; lead: EditedLead } | SalesFail;

/** A contact sent in an edit, or undefined when it would leave the lead's contact as it is. */
function contactChange(ref: ContactRef | undefined, currentId: string | null): ContactRef | undefined {
  if (ref === undefined) return undefined;
  if (ref === null) return currentId === null ? undefined : null;
  if ("id" in ref) return ref.id === currentId ? undefined : ref;
  return ref; // A new contact by name is always a change.
}

const contactSnapshot = (contacts: ResolvedContacts): ContactChange => ({
  organizationId: contacts.organization?.id ?? null,
  organizationName: contacts.organization?.name ?? null,
  personId: contacts.person?.id ?? null,
  personName: contacts.person?.name ?? null,
});

/**
 * Renames a lead, sets its Source, changes its owner, or changes its
 * organization and person (pick, new, or none: a lead may end with neither,
 * Decision 21). History gets one row per kind of change (`owner_changed`,
 * `updated`, `contact_changed`), and none when nothing changed. A new owner
 * must have Sales access and takes the old owner's open activities on the lead
 * with it (A3); a new person joins the lead's organization.
 */
export async function updateLead(
  actor: SalesActor,
  leadId: string,
  input: UpdateLeadInput,
  meta: Meta,
): Promise<UpdateLeadResult> {
  return prisma.$transaction((tx) => retryIfRaced(() => attemptUpdate(tx, actor, leadId, input, meta)));
}

/** One try at an edit: every check on a fresh read, then the guarded owner write, the rest and its history. */
async function attemptUpdate(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  leadId: string,
  input: UpdateLeadInput,
  meta: Meta,
): Promise<UpdateLeadResult | typeof RACED> {
  const found = await findLeadForEdit(tx, actor, leadId, EDIT_LEAD_SELECT);
  if (!found.ok) return found;
  const lead = found.lead;
  const closed = refuseUnlessOpen(lead.status);
  if (closed) return closed;

  const current: EditedLead = {
    id: lead.id,
    title: lead.title,
    source: lead.source,
    ownerId: lead.ownerId,
    organizationId: lead.organizationId,
    personId: lead.personId,
  };
  const ownerId = input.ownerId ?? lead.ownerId;
  const ownerChanged = ownerId !== lead.ownerId;
  const edits = auditDiff(
    { title: lead.title, source: lead.source },
    { title: input.title ?? lead.title, source: input.source ?? lead.source },
  ) as { before: Partial<Pick<EditedLead, "title" | "source">>; after: Partial<Pick<EditedLead, "title" | "source">> };
  const edited = Object.keys(edits.after).length > 0;
  const organizationRef = contactChange(input.organization, lead.organizationId);
  const personRef = contactChange(input.person, lead.personId);
  const contactsChanged = organizationRef !== undefined || personRef !== undefined;

  if (!ownerChanged && !edited && !contactsChanged) return { ok: true, lead: current };

  if (ownerChanged) {
    const member = await tx.teamMember.findFirst({ where: { id: ownerId, ...SALES_MEMBER_WHERE }, select: { id: true } });
    if (!member) return fail(400, CHOOSE_SALES_MEMBER);
  }

  // Only the contacts that change are checked or made; the others stay as they are.
  const contactInput = { organization: organizationRef ?? null, person: personRef ?? null };
  const checked = await checkContactRefs(tx, actor, contactInput);
  if (!checked.ok) return checked;

  // The last check has passed. The owner change is the first write, and lands
  // only on the lead as it was read (same owner, still open, not deleted).
  let movedActivityIds: string[] = [];
  if (ownerChanged) {
    const guarded = await tx.salesLead.updateMany({
      where: { id: leadId, ownerId: lead.ownerId, status: "OPEN", archivedAt: null },
      data: { ownerId },
    });
    if (guarded.count === 0) return RACED;

    // Read while this transaction holds the lead's row, so a convert waits: an
    // activity it moves to a deal (dealId set) never moves here too.
    const open = await tx.salesActivity.findMany({
      where: { leadId, dealId: null, ownerId: lead.ownerId, doneAt: null, archivedAt: null },
      select: { id: true },
    });
    movedActivityIds = open.map((activity) => activity.id);
    if (movedActivityIds.length > 0) {
      await tx.salesActivity.updateMany({
        where: { id: { in: movedActivityIds }, dealId: null, ownerId: lead.ownerId },
        data: { ownerId },
      });
    }
  }

  let contacts: ResolvedContacts = { organization: lead.organization, person: lead.person };
  if (contactsChanged) {
    // A contact left as it is passes through as picked, so a new person joins the lead's organization.
    contacts = await createContacts(
      tx,
      actor,
      contactInput,
      {
        organization: organizationRef === undefined ? lead.organization : checked.picked.organization,
        person: personRef === undefined ? lead.person : checked.picked.person,
      },
      ownerId,
      meta,
    );
  }

  const data: Prisma.SalesLeadUncheckedUpdateInput = { ...edits.after };
  if (organizationRef !== undefined) data.organizationId = contacts.organization?.id ?? null;
  if (personRef !== undefined) data.personId = contacts.person?.id ?? null;
  if (Object.keys(data).length > 0) await tx.salesLead.update({ where: { id: leadId }, data, select: { id: true } });

  if (ownerChanged) {
    await recordLeadAudit(
      tx,
      actor,
      leadId,
      {
        action: "owner_changed",
        before: { ownerId: lead.ownerId },
        after: movedActivityIds.length > 0 ? { ownerId, movedActivityIds } : { ownerId },
      },
      meta,
    );
  }
  if (edited) await recordLeadAudit(tx, actor, leadId, { action: "updated", ...edits }, meta);
  if (contactsChanged) {
    await recordLeadAudit(
      tx,
      actor,
      leadId,
      {
        action: "contact_changed",
        before: contactSnapshot({ organization: lead.organization, person: lead.person }),
        after: contactSnapshot(contacts),
      },
      meta,
    );
  }

  return {
    ok: true,
    lead: {
      id: leadId,
      title: input.title ?? lead.title,
      source: input.source ?? lead.source,
      ownerId,
      organizationId: contacts.organization?.id ?? null,
      personId: contacts.person?.id ?? null,
    },
  };
}

// --- Archive and restore ---

type ArchiveLeadResult = { ok: true; changed: boolean } | SalesFail;

/**
 * Archives an open lead (status ARCHIVED; it leaves the Inbox but still opens,
 * with Restore) or restores an archived one (back to OPEN). Decision 6: archive
 * never deletes, so it offers Undo. Asking for the state the lead is already in
 * changes nothing (`changed: false`, no history row).
 */
export async function setLeadArchived(
  actor: SalesActor,
  leadId: string,
  archived: boolean,
  meta: Meta,
): Promise<ArchiveLeadResult> {
  return prisma.$transaction((tx) => retryIfRaced(() => attemptArchive(tx, actor, leadId, archived, meta)));
}

async function attemptArchive(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  leadId: string,
  archived: boolean,
  meta: Meta,
): Promise<ArchiveLeadResult | typeof RACED> {
  const found = await findLeadForEdit(tx, actor, leadId, { ownerId: true, status: true });
  if (!found.ok) return found;
  const { ownerId, status } = found.lead;
  if (status === "CONVERTED") return fail(409, LEAD_CONVERTED);

  const from: SalesLeadStatus = archived ? "OPEN" : "ARCHIVED";
  const to: SalesLeadStatus = archived ? "ARCHIVED" : "OPEN";
  if (status === to) return { ok: true, changed: false };

  const guarded = await tx.salesLead.updateMany({
    where: { id: leadId, status: from, archivedAt: null, ownerId },
    data: { status: to },
  });
  if (guarded.count === 0) return RACED;

  await recordLeadAudit(tx, actor, leadId, { action: "status_changed", before: { status: from }, after: { status: to } }, meta);
  return { ok: true, changed: true };
}

// --- Delete ---

type DeleteLeadResult = { ok: true } | SalesFail;

/**
 * Deletes a lead (sets `archivedAt`): admins only, whatever its status
 * (Decision 6). A refused attempt on a lead the person can see is itself
 * recorded (spec rule 6); a lead they cannot see is "not found" with no row,
 * so made-up ids cannot fill the log.
 */
export async function deleteLead(actor: SalesActor, leadId: string, meta: Meta, now: Date): Promise<DeleteLeadResult> {
  return prisma.$transaction(async (tx): Promise<DeleteLeadResult> => {
    // Not findLeadForEdit: a non-owner who can see the lead must reach the refusal row, not "Only the lead owner...".
    const lead = await tx.salesLead.findFirst({ where: visibleLeadWhere(actor, leadId), select: { id: true } });
    if (!lead) return fail(404, LEAD_NOT_FOUND);

    if (!canDeleteSalesRecords(actor)) {
      // Returned, not thrown, so the transaction commits and the attempt stays on record.
      await recordLeadAudit(tx, actor, leadId, { action: "delete_refused" }, meta);
      return fail(403, ONLY_ADMIN_DELETES_LEADS);
    }

    // Lands once: a second delete of the same lead (a double click) finds it gone.
    const deleted = await tx.salesLead.updateMany({ where: { id: leadId, archivedAt: null }, data: { archivedAt: now } });
    if (deleted.count === 0) return fail(404, LEAD_NOT_FOUND);
    await recordLeadAudit(
      tx,
      actor,
      leadId,
      { action: "archived", before: { archivedAt: null }, after: { archivedAt: now.toISOString() } },
      meta,
    );
    return { ok: true };
  });
}

// --- Custom fields ---

type SetLeadFieldResult = { ok: true; value: string | null } | SalesFail;

/**
 * Sets or clears one custom field on an open lead. The field must be a live
 * LEAD field other than Form Source and Practice Name, which Source and
 * Organization supersede (Decision 8). Values are checked the same way as on
 * deals; the same value again changes nothing.
 */
export async function setLeadField(
  actor: SalesActor,
  leadId: string,
  fieldKey: string,
  value: string | null,
  meta: Meta,
): Promise<SetLeadFieldResult> {
  return prisma.$transaction(async (tx): Promise<SetLeadFieldResult> => {
    const found = await findLeadForEdit(tx, actor, leadId, { ownerId: true, status: true });
    if (!found.ok) return found;
    const closed = refuseUnlessOpen(found.lead.status);
    if (closed) return closed;

    if ((LEAD_HIDDEN_FIELD_KEYS as readonly string[]).includes(fieldKey)) return fail(404, FIELD_NOT_USED);
    const field = await tx.salesCustomField.findFirst({
      where: { key: fieldKey, entity: "LEAD", archivedAt: null },
      select: LEAD_FIELD_SELECT,
    });
    if (!field) return fail(404, FIELD_NOT_USED);

    const normalized = normalizeFieldValue(field, value);
    if (!normalized.ok) return fail(400, normalized.error);
    const next = normalized.value;

    const stored = await tx.salesCustomFieldValue.findUnique({
      where: { fieldId_leadId: { fieldId: field.id, leadId } },
      select: { value: true },
    });
    const previous = stored?.value ?? null;
    if (previous === next) return { ok: true, value: next };

    await writeLeadField(tx, actor, leadId, field, previous, next, meta);
    return { ok: true, value: next };
  });
}
