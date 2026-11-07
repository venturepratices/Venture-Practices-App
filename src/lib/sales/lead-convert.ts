import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrismaError } from "@/lib/prisma-errors";
import { SALES_MEMBER_WHERE, type SalesActor } from "@/lib/sales/access";
import type { SalesRequestMeta } from "@/lib/sales/audit";
import { isBoardPipeline } from "@/lib/sales/board";
import { BOARD_PIPELINE_KINDS, BULK_CONVERT_MAX, CONVERT_FIRST_CALL_SUBJECT } from "@/lib/sales/constants";
import { checkContactRefs, contactRefSchema, createContacts, type ResolvedContacts } from "@/lib/sales/contact-write";
import { recordDealAudit } from "@/lib/sales/deal-audit";
import { moneySchema } from "@/lib/sales/deals";
import { fail, type SalesFail } from "@/lib/sales/http";
import { findLeadForEdit, LEAD_ARCHIVED, LEAD_JUST_CHANGED } from "@/lib/sales/lead-access";
import { recordLeadAudit } from "@/lib/sales/lead-audit";
import { checkStageMove } from "@/lib/sales/rules";
import { dateInputValue, endOfDay } from "@/lib/utils";

// Turning a lead into a deal (Decision 14), one from the lead panel or up to 25
// from the Leads Inbox bulk bar (Decision 15). One transaction per lead, and
// every check that can refuse runs before the first write: a refusal is
// returned from the transaction (which then commits), so nothing may have been
// written by then.
//
// The first write marks the lead CONVERTED, and it lands only on the lead
// exactly as it was checked: still open, not deleted, and still owned by the
// person it was read with. A second click, or a lead given to someone else a
// moment earlier, matches nothing, and the convert is decided again on a fresh
// read (which refuses it). Because that write holds the lead's row, an activity
// or note added to the lead at the same moment either lands first and moves to
// the deal, or waits and is refused as converted (`takeOpenLead`).

type Meta = Partial<SalesRequestMeta>;

const INVALID_INPUT = "Invalid input.";
const ALREADY_CONVERTED = "This lead was already converted.";
const PICK_STAGE = "Pick a stage from the list.";
const PICK_STAGE_NO_VALUE = "Pick a stage that does not need a value.";
const OWNER_NO_ACCESS = "The lead's owner no longer has Sales access. Give the lead to someone else first.";
const NEED_CONTACT = "Add a person or an organization.";
const PICK_PIPELINE = "Pick a pipeline.";
const NO_DELIVERY = "Deals can't be added to a delivery pipeline yet.";
const ID_MAX = 64;

/** What an attempt answers when its guarded lead write matched nothing: another request changed the lead first. */
const RACED = Symbol("raced");

/**
 * Runs an attempt, and once more when it lost a race. The guarded write is the
 * attempt's first write, so an attempt that lost wrote nothing, and the second
 * one reads the lead again (each statement sees what has committed by then).
 * Losing twice answers 409.
 */
async function retryIfRaced<T>(attempt: () => Promise<T | typeof RACED>): Promise<T | SalesFail> {
  for (let tries = 0; tries < 2; tries++) {
    const result = await attempt();
    if (result !== RACED) return result;
  }
  return fail(409, LEAD_JUST_CHANGED);
}

// --- Input ---

const idSchema = z
  .string({ error: INVALID_INPUT })
  .min(1, { error: INVALID_INPUT })
  .max(ID_MAX, { error: INVALID_INPUT });

/**
 * One lead. `organization` and `person` are read only when the lead has
 * neither (A1); values are optional unless the stage needs them.
 */
export const convertLeadSchema = z.strictObject({
  pipelineId: idSchema,
  stageId: idSchema,
  organization: contactRefSchema.optional(),
  person: contactRefSchema.optional(),
  valueCents: moneySchema.optional(),
  mrrCents: moneySchema.optional(),
});

/** Up to 25 leads, to one pipeline and stage (no values, so no stage that needs them). */
export const bulkConvertSchema = z.strictObject({
  ids: z
    .array(idSchema, { error: INVALID_INPUT })
    .min(1, { error: "Pick at least one lead." })
    .max(BULK_CONVERT_MAX, { error: `Convert up to ${BULK_CONVERT_MAX} leads at a time.` })
    // A lead ticked twice is converted once.
    .transform((ids) => [...new Set(ids)]),
  pipelineId: idSchema,
  stageId: idSchema,
});

export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;
export type BulkConvertInput = z.infer<typeof bulkConvertSchema>;

// --- Where a lead can go ---

export type ConvertTarget = {
  id: string;
  key: string;
  name: string;
  stages: { id: string; name: string; requiresValue: boolean }[];
};

/** A converted deal never lands on a won, lost or No Show stage, or one that is gone (A1). */
const CONVERT_STAGE_WHERE = { archivedAt: null, isWon: false, isLost: false, isNoShow: false } satisfies Prisma.SalesStageWhereInput;
const TARGET_STAGE_SELECT = { id: true, name: true, requiresValue: true } satisfies Prisma.SalesStageSelect;

/** The Sales and Consulting pipelines in board order, each with the stages a lead may be converted into, in order. */
export async function loadConvertTargets(db: Pick<typeof prisma, "salesPipeline"> = prisma): Promise<ConvertTarget[]> {
  return db.salesPipeline.findMany({
    where: { archivedAt: null, kind: { in: [...BOARD_PIPELINE_KINDS] } },
    orderBy: { position: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      stages: { where: CONVERT_STAGE_WHERE, orderBy: { position: "asc" }, select: TARGET_STAGE_SELECT },
    },
  });
}

type Target = {
  pipeline: { id: string; key: string; name: string };
  stage: Prisma.SalesStageGetPayload<{ select: typeof TARGET_STAGE_SELECT }>;
};

/** The picked pipeline and stage, checked against the same rules as the list above. Reads only. */
async function findTarget(
  db: Pick<Prisma.TransactionClient, "salesPipeline" | "salesStage">,
  pipelineId: string,
  stageId: string,
): Promise<({ ok: true } & Target) | SalesFail> {
  const pipeline = await db.salesPipeline.findFirst({
    where: { id: pipelineId, archivedAt: null },
    select: { id: true, key: true, name: true, kind: true },
  });
  if (!pipeline) return fail(400, PICK_PIPELINE);
  if (!isBoardPipeline(pipeline)) return fail(400, NO_DELIVERY);

  const stage = await db.salesStage.findFirst({
    where: { id: stageId, pipelineId: pipeline.id, ...CONVERT_STAGE_WHERE },
    select: TARGET_STAGE_SELECT,
  });
  if (!stage) return fail(400, PICK_STAGE);

  return { ok: true, pipeline: { id: pipeline.id, key: pipeline.key, name: pipeline.name }, stage };
}

// --- One lead ---

const CONVERT_LEAD_SELECT = {
  id: true,
  title: true,
  ownerId: true,
  status: true,
  source: true,
  organization: { select: { id: true, name: true } },
  person: { select: { id: true, name: true } },
} satisfies Prisma.SalesLeadSelect;

type ConvertLeadResult = { ok: true; deal: { id: string; pipelineKey: string; pipelineName: string } } | SalesFail;

/**
 * Converts one open lead into a deal owned by the lead owner, with the lead's
 * title, source, organization and person (or, when the lead has neither, the
 * ones picked or typed in the dialog, made for the lead owner). The lead's open
 * activities and live notes move to the deal (`leadId` kept); with no open
 * activity to move, the deal gets a call due today. Custom field values stay
 * on the lead. History: a deal `created` row naming the lead and what moved,
 * and a lead `converted` row.
 */
export async function convertLead(
  actor: SalesActor,
  leadId: string,
  input: ConvertLeadInput,
  meta: Meta,
  now: Date,
): Promise<ConvertLeadResult> {
  try {
    return await prisma.$transaction((tx) => retryIfRaced(() => attemptConvert(tx, actor, leadId, input, meta, now)));
  } catch (error) {
    // A lead points at one deal (`convertedDealId` is unique). Should that ever
    // clash, the transaction has already rolled back: answer as a second click.
    if (isPrismaError(error, "P2002")) return fail(409, ALREADY_CONVERTED);
    throw error;
  }
}

/** One try at a convert: every check on a fresh read, then the guarded status write, the deal, the moves and the history. */
async function attemptConvert(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  leadId: string,
  input: ConvertLeadInput,
  meta: Meta,
  now: Date,
): Promise<ConvertLeadResult | typeof RACED> {
  const found = await findLeadForEdit(tx, actor, leadId, CONVERT_LEAD_SELECT);
  if (!found.ok) return found;
  const lead = found.lead;
  if (lead.status === "CONVERTED") return fail(409, ALREADY_CONVERTED);
  if (lead.status === "ARCHIVED") return fail(409, LEAD_ARCHIVED);

  // The deal goes to the lead owner, who must still be able to own one.
  const owner = await tx.teamMember.findFirst({ where: { id: lead.ownerId, ...SALES_MEMBER_WHERE }, select: { id: true } });
  if (!owner) return fail(400, OWNER_NO_ACCESS);

  const target = await findTarget(tx, input.pipelineId, input.stageId);
  if (!target.ok) return target;
  const { pipeline, stage } = target;

  // The lead's own contacts are kept as they are; the dialog's pickers count
  // only when the lead has neither (A1). Picked ones are checked here, and new
  // ones are made only after the guarded write.
  const hasOwnContacts = lead.organization !== null || lead.person !== null;
  const contactInput = hasOwnContacts
    ? { organization: null, person: null }
    : { organization: input.organization ?? null, person: input.person ?? null };
  if (!hasOwnContacts && !contactInput.organization && !contactInput.person) return fail(400, NEED_CONTACT);
  let picked: ResolvedContacts | null = null;
  if (!hasOwnContacts) {
    const checked = await checkContactRefs(tx, actor, contactInput);
    if (!checked.ok) return checked;
    picked = checked.picked;
  }

  // The money rule, on the values sent (spec rules 2 and 8).
  const value = { valueCents: input.valueCents ?? 0, mrrCents: input.mrrCents ?? 0 };
  const violation = checkStageMove(value, stage);
  if (violation) return fail(422, violation.message, violation.code);

  // The last check has passed. The first write lands only on the lead as it was read.
  const guarded = await tx.salesLead.updateMany({
    where: { id: lead.id, status: "OPEN", archivedAt: null, ownerId: lead.ownerId },
    data: { status: "CONVERTED" },
  });
  if (guarded.count === 0) return RACED;

  const contacts: ResolvedContacts = picked
    ? await createContacts(tx, actor, contactInput, picked, lead.ownerId, meta)
    : { organization: lead.organization, person: lead.person };

  const fields = {
    title: lead.title,
    pipelineId: pipeline.id,
    stageId: stage.id,
    ownerId: lead.ownerId,
    organizationId: contacts.organization?.id ?? null,
    personId: contacts.person?.id ?? null,
    valueCents: value.valueCents,
    mrrCents: value.mrrCents,
    source: lead.source,
  };
  const deal = await tx.salesDeal.create({ data: { ...fields, stageEnteredAt: now }, select: { id: true } });
  await tx.salesLead.update({ where: { id: lead.id }, data: { convertedDealId: deal.id }, select: { id: true } });

  // What moves keeps its `leadId`, so where it came from stays on record.
  const openActivities = await tx.salesActivity.findMany({
    where: { leadId: lead.id, dealId: null, doneAt: null, archivedAt: null },
    select: { id: true },
  });
  const movedActivityIds = openActivities.map((activity) => activity.id);
  if (movedActivityIds.length > 0) {
    await tx.salesActivity.updateMany({ where: { id: { in: movedActivityIds } }, data: { dealId: deal.id } });
  }
  const liveNotes = await tx.salesNote.findMany({
    where: { leadId: lead.id, dealId: null, archivedAt: null },
    select: { id: true },
  });
  const movedNoteIds = liveNotes.map((note) => note.id);
  if (movedNoteIds.length > 0) {
    await tx.salesNote.updateMany({ where: { id: { in: movedNoteIds } }, data: { dealId: deal.id } });
  }

  // A deal always has a next step: with none moved, the owner gets a call today.
  let firstCall: { id: string; dueAt: Date } | null = null;
  if (movedActivityIds.length === 0) {
    const dueAt = endOfDay(dateInputValue(now));
    const activity = await tx.salesActivity.create({
      data: {
        type: "CALL",
        subject: CONVERT_FIRST_CALL_SUBJECT,
        dueAt,
        hasTime: false,
        ownerId: lead.ownerId,
        dealId: deal.id,
        personId: contacts.person?.id ?? null,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    firstCall = { id: activity.id, dueAt };
  }

  await recordDealAudit(
    tx,
    actor,
    deal.id,
    { action: "created", after: { ...fields, stageName: stage.name, fromLeadId: lead.id, movedActivityIds, movedNoteIds } },
    meta,
  );
  if (firstCall) {
    await recordDealAudit(
      tx,
      actor,
      deal.id,
      {
        action: "activity_added",
        after: {
          activityId: firstCall.id,
          type: "CALL",
          subject: CONVERT_FIRST_CALL_SUBJECT,
          dueAt: firstCall.dueAt.toISOString(),
          hasTime: false,
          createdBy: actor.userId,
        },
      },
      meta,
    );
  }
  await recordLeadAudit(tx, actor, lead.id, { action: "converted", after: { dealId: deal.id } }, meta);

  return { ok: true, deal: { id: deal.id, pipelineKey: pipeline.key, pipelineName: pipeline.name } };
}

// --- Many leads ---

export type BulkConvertResult = { id: string; ok: true; dealId: string } | { id: string; ok: false; error: string };
type ConvertLeadsResult = { ok: true; results: BulkConvertResult[]; pipeline: { key: string; name: string } } | SalesFail;

/**
 * Converts each lead to the same pipeline and stage, one after another, each in
 * its own transaction through `convertLead`, so one lead's refusal never undoes
 * another's convert. The pipeline and stage are checked once for the whole
 * request first; a stage that needs a value is refused, since bulk sends none.
 * A lead with neither person nor organization is refused on its own and named
 * in its result.
 */
export async function convertLeads(
  actor: SalesActor,
  input: BulkConvertInput,
  meta: Meta,
  now: Date,
): Promise<ConvertLeadsResult> {
  const target = await findTarget(prisma, input.pipelineId, input.stageId);
  if (!target.ok) return target;
  if (target.stage.requiresValue) return fail(400, PICK_STAGE_NO_VALUE);

  const results: BulkConvertResult[] = [];
  for (const id of input.ids) {
    const result = await convertLead(actor, id, { pipelineId: input.pipelineId, stageId: input.stageId }, meta, now);
    results.push(result.ok ? { id, ok: true, dealId: result.deal.id } : { id, ok: false, error: result.error });
  }
  return { ok: true, results, pipeline: { key: target.pipeline.key, name: target.pipeline.name } };
}
