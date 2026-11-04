import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canDeleteSalesRecords, dealOwnerWhere, SALES_MEMBER_WHERE, type SalesActor } from "@/lib/sales/access";
import { auditDiff, recordSalesAudit, type SalesRequestMeta } from "@/lib/sales/audit";
import { isBoardPipeline } from "@/lib/sales/board";
import {
  DEAL_SOURCES,
  FIRST_ACTIVITY_PRESETS,
  MAX_DEAL_CENTS,
  TERRITORY_HOLD_FIELD_KEY,
  TITLE_MAX,
} from "@/lib/sales/constants";
import { FIELD_TOO_LONG, normalizeFieldValue } from "@/lib/sales/custom-fields";
import { DEAL_NOT_FOUND, findDealForEdit, visibleDealWhere } from "@/lib/sales/deal-access";
import { recordDealAudit } from "@/lib/sales/deal-audit";
import { activityDueAt } from "@/lib/sales/format";
import { fail, type SalesFail } from "@/lib/sales/http";
import { checkStageMove, territoryHoldCheckDueAt } from "@/lib/sales/rules";
import { addDaysToDateString, dateInputValue } from "@/lib/utils";

// Adding, editing and deleting deals, and setting their custom fields. Each
// change runs in one transaction with its history rows. Every check that can
// refuse runs before the first write: a refusal is returned from the
// transaction (which then commits), so nothing may have been written by then.

type Meta = Partial<SalesRequestMeta>;

const ONLY_YOURSELF = "You can only add deals for yourself.";
const CHOOSE_OWNER = "Choose a team member with Sales access.";
const NEED_CONTACT = "Add a person or an organization.";
const PICK_PIPELINE = "Pick a pipeline.";
const NO_DELIVERY = "Deals can't be added to a delivery pipeline yet.";
const ORG_NOT_FOUND = "That organization was not found.";
const PERSON_NOT_FOUND = "That person was not found.";
const VALUE_TOO_BIG = "Values can be up to $10,000,000.";
const PROPOSAL_NEEDS_VALUE = "A deal in Proposal Sent needs a total value and a monthly value above $0.";
const ONLY_ADMIN_DELETES = "Only an admin can delete deals.";
const FIELD_NOT_USED = "That field is not used on this deal.";

/** Every deal made with the Add deal dialog is marked as added by hand (Decision 18). */
const HAND_MADE_SOURCE = "Added by hand";
const TERRITORY_HOLD_RULE = "rule:territory-hold";
const TERRITORY_HOLD_SUBJECT = "Territory hold check";
const ID_MAX = 64;
/** Room for padding around a 500-character value; the field check trims, then holds it to 500. */
const FIELD_BODY_MAX = 2_000;

// --- Input ---

const money = z
  .int({ error: "Enter an amount." })
  .min(0, { error: "Values can't be below $0." })
  .max(MAX_DEAL_CENTS, { error: VALUE_TOO_BIG });

/** An existing organization or person picked by id, or a new one by name. */
const contactSchema = z
  .union([
    z.strictObject({ id: z.string().min(1).max(ID_MAX) }),
    z.strictObject({ name: z.string().trim().min(1).max(TITLE_MAX) }),
  ])
  .nullable()
  .default(null);

const FIRST_ACTIVITY_IDS = ["call-today", "call-tomorrow", "demo-2-days"] as const satisfies readonly (keyof typeof FIRST_ACTIVITY_PRESETS)[];

export const createDealSchema = z.strictObject({
  pipelineId: z.string({ error: PICK_PIPELINE }).min(1, { error: PICK_PIPELINE }).max(ID_MAX, { error: PICK_PIPELINE }),
  ownerId: z.string({ error: CHOOSE_OWNER }).min(1, { error: CHOOSE_OWNER }).max(ID_MAX, { error: CHOOSE_OWNER }),
  organization: contactSchema,
  person: contactSchema,
  valueCents: money.default(0),
  firstActivity: z.enum(FIRST_ACTIVITY_IDS, { error: "Pick a first activity." }),
});

export const updateDealSchema = z
  .strictObject({
    title: z
      .string()
      .trim()
      .min(1, { error: "Give the deal a name." })
      .max(TITLE_MAX, { error: "Keep the name under 200 characters." })
      .optional(),
    valueCents: money.optional(),
    mrrCents: money.optional(),
    ownerId: z.string({ error: CHOOSE_OWNER }).min(1, { error: CHOOSE_OWNER }).max(ID_MAX, { error: CHOOSE_OWNER }).optional(),
    source: z.enum(DEAL_SOURCES, { error: "Pick one of the listed sources." }).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), { error: "Nothing to change." });

/** The PUT body for one custom field: the typed text, or null to clear it. */
export const dealFieldSchema = z.strictObject({
  value: z.string().max(FIELD_BODY_MAX, { error: FIELD_TOO_LONG }).nullable(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

// --- Add ---

type CreateDealResult = { ok: true; deal: { id: string; pipelineKey: string } } | SalesFail;

/**
 * Adds a deal in the pipeline's first stage, with its first activity (spec rule 1)
 * owned by the deal owner (Decision 15). A new organization or person is made
 * for the same owner and gets its own `created` history row before the deal's
 * rows (Decision 32). Only an admin may add a deal for someone else.
 */
export async function createDeal(
  actor: SalesActor,
  input: CreateDealInput,
  meta: Meta,
  now: Date,
): Promise<CreateDealResult> {
  if (!actor.isAdmin && input.ownerId !== actor.userId) return fail(403, ONLY_YOURSELF);
  const orgInput = input.organization;
  const personInput = input.person;
  if (!orgInput && !personInput) return fail(400, NEED_CONTACT);

  return prisma.$transaction(async (tx): Promise<CreateDealResult> => {
    const owner = await tx.teamMember.findFirst({ where: { id: input.ownerId, ...SALES_MEMBER_WHERE }, select: { id: true } });
    if (!owner) return fail(400, CHOOSE_OWNER);

    const pipeline = await tx.salesPipeline.findFirst({
      where: { id: input.pipelineId, archivedAt: null },
      select: { id: true, key: true, kind: true },
    });
    if (!pipeline) return fail(400, PICK_PIPELINE);
    if (!isBoardPipeline(pipeline)) return fail(400, NO_DELIVERY);

    const stage = await tx.salesStage.findFirst({
      where: { pipelineId: pipeline.id, archivedAt: null },
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    });
    if (!stage) return fail(400, PICK_PIPELINE);

    // A picked organization or person must be one this person could find in the picker.
    const visible = { archivedAt: null, ...dealOwnerWhere(actor, "everyone") };
    let organization =
      orgInput && "id" in orgInput
        ? await tx.salesOrganization.findFirst({ where: { id: orgInput.id, ...visible }, select: { id: true, name: true } })
        : null;
    if (orgInput && "id" in orgInput && !organization) return fail(400, ORG_NOT_FOUND);
    let person =
      personInput && "id" in personInput
        ? await tx.salesPerson.findFirst({ where: { id: personInput.id, ...visible }, select: { id: true, name: true } })
        : null;
    if (personInput && "id" in personInput && !person) return fail(400, PERSON_NOT_FOUND);

    // Checks done; from here on everything is written.
    if (orgInput && "name" in orgInput) {
      const data = { name: orgInput.name, ownerId: input.ownerId };
      organization = await tx.salesOrganization.create({ data, select: { id: true, name: true } });
      await recordSalesAudit(
        tx,
        actor,
        { entityType: "SalesOrganization", entityId: organization.id, action: "created", after: data },
        meta,
      );
    }
    if (personInput && "name" in personInput) {
      const data = { name: personInput.name, ownerId: input.ownerId, organizationId: organization?.id ?? null };
      person = await tx.salesPerson.create({ data, select: { id: true, name: true } });
      await recordSalesAudit(tx, actor, { entityType: "SalesPerson", entityId: person.id, action: "created", after: data }, meta);
    }

    const fields = {
      // Named after the practice when there is one, else the person.
      title: (organization?.name ?? person?.name ?? "").slice(0, TITLE_MAX),
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: input.ownerId,
      organizationId: organization?.id ?? null,
      personId: person?.id ?? null,
      valueCents: input.valueCents,
      mrrCents: 0,
    };
    const deal = await tx.salesDeal.create({
      data: { ...fields, stageEnteredAt: now, source: HAND_MADE_SOURCE },
      select: { id: true },
    });
    await recordDealAudit(
      tx,
      actor,
      deal.id,
      { action: "created", after: { ...fields, stageName: stage.name, source: HAND_MADE_SOURCE } },
      meta,
    );

    const preset = FIRST_ACTIVITY_PRESETS[input.firstActivity];
    const dueAt = activityDueAt(addDaysToDateString(dateInputValue(now), preset.offsetDays), null);
    const activity = await tx.salesActivity.create({
      data: {
        type: preset.type,
        subject: preset.subject,
        dueAt,
        hasTime: false,
        ownerId: input.ownerId,
        dealId: deal.id,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await recordDealAudit(
      tx,
      actor,
      deal.id,
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

    return { ok: true, deal: { id: deal.id, pipelineKey: pipeline.key } };
  });
}

// --- Edit ---

const EDITABLE_DEAL_SELECT = {
  id: true,
  title: true,
  valueCents: true,
  mrrCents: true,
  ownerId: true,
  source: true,
} satisfies Prisma.SalesDealSelect;

type EditableDeal = Prisma.SalesDealGetPayload<{ select: typeof EDITABLE_DEAL_SELECT }>;
type UpdateDealResult = { ok: true; deal: EditableDeal } | SalesFail;

/**
 * Changes a deal's name, source, values or owner. History gets one row per kind
 * of change (`value_changed`, `owner_changed`, `updated`), and none when nothing
 * changed. A deal in a stage that needs a value (Proposal Sent) cannot have
 * either value cleared (spec rules 2 and 8, Decision 27). A new owner takes the
 * old owner's open activities on the deal with it (Decision 15).
 */
export async function updateDeal(
  actor: SalesActor,
  dealId: string,
  input: UpdateDealInput,
  meta: Meta,
  now: Date,
): Promise<UpdateDealResult> {
  return prisma.$transaction(async (tx): Promise<UpdateDealResult> => {
    const found = await findDealForEdit(tx, actor, dealId, {
      ...EDITABLE_DEAL_SELECT,
      stage: { select: { requiresValue: true } },
    });
    if (!found.ok) return found;
    const { stage } = found.deal;
    const deal: EditableDeal = {
      id: found.deal.id,
      title: found.deal.title,
      valueCents: found.deal.valueCents,
      mrrCents: found.deal.mrrCents,
      ownerId: found.deal.ownerId,
      source: found.deal.source,
    };

    const value = { valueCents: input.valueCents ?? deal.valueCents, mrrCents: input.mrrCents ?? deal.mrrCents };
    const valueChanged = value.valueCents !== deal.valueCents || value.mrrCents !== deal.mrrCents;
    const ownerId = input.ownerId ?? deal.ownerId;
    const ownerChanged = ownerId !== deal.ownerId;
    const edits = auditDiff(
      { title: deal.title, source: deal.source },
      { title: input.title ?? deal.title, source: input.source === undefined ? deal.source : input.source },
    ) as { before: Partial<Pick<EditableDeal, "title" | "source">>; after: Partial<Pick<EditableDeal, "title" | "source">> };
    const edited = Object.keys(edits.after).length > 0;

    if (!valueChanged && !ownerChanged && !edited) return { ok: true, deal };

    // Checked against the stored stage and values, so a stale screen cannot clear them (Review Focus 1).
    if (valueChanged && checkStageMove(value, stage)) return fail(422, PROPOSAL_NEEDS_VALUE, "PROPOSAL_NEEDS_VALUE");

    let movedActivityIds: string[] = [];
    if (ownerChanged) {
      const member = await tx.teamMember.findFirst({ where: { id: ownerId, ...SALES_MEMBER_WHERE }, select: { id: true } });
      if (!member) return fail(400, CHOOSE_OWNER);
      const open = await tx.salesActivity.findMany({
        where: { dealId, ownerId: deal.ownerId, doneAt: null, archivedAt: null },
        select: { id: true },
      });
      movedActivityIds = open.map((activity) => activity.id);
    }

    // Only what changed, stamped with this request's time.
    const data: Prisma.SalesDealUncheckedUpdateInput = { ...edits.after, updatedAt: now };
    if (value.valueCents !== deal.valueCents) data.valueCents = value.valueCents;
    if (value.mrrCents !== deal.mrrCents) data.mrrCents = value.mrrCents;
    if (ownerChanged) data.ownerId = ownerId;
    const updated = await tx.salesDeal.update({ where: { id: dealId }, data, select: EDITABLE_DEAL_SELECT });

    if (valueChanged) {
      await recordDealAudit(
        tx,
        actor,
        dealId,
        { action: "value_changed", before: { valueCents: deal.valueCents, mrrCents: deal.mrrCents }, after: value },
        meta,
      );
    }
    if (ownerChanged) {
      if (movedActivityIds.length > 0) {
        await tx.salesActivity.updateMany({ where: { id: { in: movedActivityIds } }, data: { ownerId } });
      }
      await recordDealAudit(
        tx,
        actor,
        dealId,
        {
          action: "owner_changed",
          before: { ownerId: deal.ownerId },
          after: movedActivityIds.length > 0 ? { ownerId, movedActivityIds } : { ownerId },
        },
        meta,
      );
    }
    if (edited) await recordDealAudit(tx, actor, dealId, { action: "updated", ...edits }, meta);

    return { ok: true, deal: updated };
  });
}

// --- Delete ---

type ArchiveDealResult = { ok: true } | SalesFail;

/**
 * Deletes (archives) a deal: admins only. A refused attempt on a deal the person
 * can see is itself recorded (spec rule 6, Decision 32); a deal they cannot see
 * is "not found" with no row, so made-up ids cannot fill the log.
 */
export async function archiveDeal(actor: SalesActor, dealId: string, meta: Meta, now: Date): Promise<ArchiveDealResult> {
  return prisma.$transaction(async (tx): Promise<ArchiveDealResult> => {
    // Not findDealForEdit: a non-owner who can see the deal must reach the refusal row, not "Only the deal owner...".
    const deal = await tx.salesDeal.findFirst({ where: visibleDealWhere(actor, dealId), select: { id: true } });
    if (!deal) return fail(404, DEAL_NOT_FOUND);

    if (!canDeleteSalesRecords(actor)) {
      // Returned, not thrown, so the transaction commits and the attempt stays on record.
      await recordDealAudit(tx, actor, dealId, { action: "delete_refused" }, meta);
      return fail(403, ONLY_ADMIN_DELETES);
    }

    await tx.salesDeal.update({ where: { id: dealId }, data: { archivedAt: now }, select: { id: true } });
    await recordDealAudit(
      tx,
      actor,
      dealId,
      { action: "archived", before: { archivedAt: null }, after: { archivedAt: now.toISOString() } },
      meta,
    );
    return { ok: true };
  });
}

// --- Custom fields ---

type SetDealFieldResult = { ok: true; value: string | null } | SalesFail;
type OpenCheck = Prisma.SalesActivityGetPayload<{ select: { id: true; type: true; subject: true } }>;

/**
 * Sets or clears one custom field on a deal. The field must be a deal field used
 * by the deal's pipeline. DATE values are stored "YYYY-MM-DD" (Ruling 16). The
 * Territory Hold Expiry field also keeps the territory hold check in step
 * (spec rule 4, Decision 28).
 */
export async function setDealField(
  actor: SalesActor,
  dealId: string,
  fieldKey: string,
  value: string | null,
  meta: Meta,
  now: Date,
): Promise<SetDealFieldResult> {
  return prisma.$transaction(async (tx): Promise<SetDealFieldResult> => {
    const found = await findDealForEdit(tx, actor, dealId, { ownerId: true, pipeline: { select: { key: true } } });
    if (!found.ok) return found;
    const deal = found.deal;

    const field = await tx.salesCustomField.findFirst({
      where: { key: fieldKey, entity: "DEAL", archivedAt: null },
      select: { id: true, key: true, label: true, fieldType: true, options: true, pipelineKeys: true },
    });
    // A field with no pipeline list belongs to every deal pipeline (the panel shows it the same way).
    if (!field || (field.pipelineKeys.length > 0 && !field.pipelineKeys.includes(deal.pipeline.key))) {
      return fail(404, FIELD_NOT_USED);
    }

    const normalized = normalizeFieldValue(field, value);
    if (!normalized.ok) return fail(400, normalized.error);
    const next = normalized.value;

    const where = { fieldId_dealId: { fieldId: field.id, dealId } };
    const stored = await tx.salesCustomFieldValue.findUnique({ where, select: { value: true } });
    const previous = stored?.value ?? null;
    if (previous === next) return { ok: true, value: next };

    const isHold = field.key === TERRITORY_HOLD_FIELD_KEY;
    const openChecks: OpenCheck[] = isHold
      ? await tx.salesActivity.findMany({
          where: { dealId, createdBy: TERRITORY_HOLD_RULE, doneAt: null, archivedAt: null },
          select: { id: true, type: true, subject: true },
        })
      : [];

    if (next === null) {
      await tx.salesCustomFieldValue.delete({ where });
    } else {
      await tx.salesCustomFieldValue.upsert({ where, create: { fieldId: field.id, dealId, value: next }, update: { value: next } });
    }
    await recordDealAudit(
      tx,
      actor,
      dealId,
      {
        action: "field_changed",
        before: { fieldKey: field.key, label: field.label, value: previous },
        after: { fieldKey: field.key, label: field.label, value: next },
      },
      meta,
    );

    if (isHold) await resetTerritoryHoldCheck(tx, dealId, deal.ownerId, openChecks, next, now);
    return { ok: true, value: next };
  });
}

/**
 * The territory hold rule: removes the open check, then (unless the expiry was
 * cleared) adds one 7 days before the new expiry, or today when that has passed.
 * The check belongs to the deal owner, and history names the rule, not a person.
 */
async function resetTerritoryHoldCheck(
  tx: Prisma.TransactionClient,
  dealId: string,
  ownerId: string,
  openChecks: OpenCheck[],
  expiry: string | null,
  now: Date,
): Promise<void> {
  const rule = { system: "rule" } as const;

  if (openChecks.length > 0) {
    await tx.salesActivity.updateMany({ where: { id: { in: openChecks.map((check) => check.id) } }, data: { archivedAt: now } });
    for (const check of openChecks) {
      await recordDealAudit(tx, rule, dealId, {
        action: "activity_removed",
        before: { activityId: check.id, type: check.type, subject: check.subject },
      });
    }
  }
  if (expiry === null) return;

  const dueAt = territoryHoldCheckDueAt(expiry, now);
  const check = await tx.salesActivity.create({
    data: {
      type: "DEADLINE",
      subject: TERRITORY_HOLD_SUBJECT,
      dueAt,
      hasTime: false,
      ownerId,
      dealId,
      createdBy: TERRITORY_HOLD_RULE,
    },
    select: { id: true },
  });
  await recordDealAudit(tx, rule, dealId, {
    action: "activity_added",
    after: {
      activityId: check.id,
      type: "DEADLINE",
      subject: TERRITORY_HOLD_SUBJECT,
      dueAt: dueAt.toISOString(),
      hasTime: false,
      createdBy: TERRITORY_HOLD_RULE,
    },
  });
}
