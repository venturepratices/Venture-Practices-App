import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { SALES_MEMBER_WHERE, type SalesActor } from "@/lib/sales/access";
import { auditDiff, recordSalesAudit, type SalesRequestMeta } from "@/lib/sales/audit";
import { loadSalesMembers, type SalesMemberOption } from "@/lib/sales/board";
import { BOARD_PIPELINE_KINDS, ROTTING_DAYS_MAX } from "@/lib/sales/constants";
import { shortName } from "@/lib/sales/format";
import { fail, type SalesFail } from "@/lib/sales/http";
import { FIRST_ADMIN_ORDER, loadAssignmentSummary, type AssignmentSummary } from "@/lib/sales/lead-assignment";

// Sales settings, for admins: who gets new leads (round-robin or one person,
// with Ruling 24's "lost Sales access" checks) and how many days a deal may sit
// in each stage before it goes stale. Every change writes its history row in
// the same transaction. Server only: client code imports types from here.

const INVALID_INPUT = "Invalid input.";
const ID_MAX = 64;
const ROTATION_MAX = 100;
const STAGES_PER_SAVE_MAX = 50;

const SALES_ACCESS_ERROR = "Choose team members with Sales access.";
const SINGLE_LOST_ACCESS = "The person who gets every new lead no longer has Sales access. Pick someone else.";
const SINGLE_MISSING = "Choose the person who gets every new lead.";
const ROTTING_ERROR = `Use a number from 1 to ${ROTTING_DAYS_MAX}, or leave it blank.`;
const CLOSED_STAGES_NEVER_ROT = "Won and lost stages never go stale.";
const STAGE_NOT_IN_PIPELINE = "That stage is not part of this pipeline.";
const PIPELINE_NOT_FOUND = "Pipeline not found.";

// --- Who gets new leads ---

type LeadAssignMode = "ROUND_ROBIN" | "SINGLE";

/** The saved choice, as the settings route answers it. The rotation cursor is never part of it. */
export type LeadAssignmentSettings = {
  leadAssignMode: LeadAssignMode;
  roundRobinMemberIds: string[];
  singleAssigneeId: string | null;
};

/** Someone the saved settings name: their name while they are on the team, and whether they can still take leads. */
export type SavedPersonView = { id: string; name: string | null; hasAccess: boolean };

/**
 * What the "Who gets new leads" card shows. `members`: everyone who can take
 * leads. `rotation` and `single`: the saved choice, each person flagged when
 * they lost Sales access (shown ticked but disabled, dropped on Save).
 * `effective`: who really gets the next lead (the Inbox footer's line).
 * `firstAdminName`: who gets leads when nobody else can (A8), named even while
 * the admin's draft has nobody ticked.
 */
export type LeadAssignmentView = {
  mode: LeadAssignMode;
  members: SalesMemberOption[];
  rotation: SavedPersonView[];
  single: SavedPersonView | null;
  effective: AssignmentSummary;
  firstAdminName: string | null;
};

// The rotation cursor is deliberately not part of this: it moves only when a lead
// is assigned (see lead-assignment.ts), never from here, and never in the history log.
const SETTINGS_SELECT = { leadAssignMode: true, roundRobinMemberIds: true, singleAssigneeId: true } as const;

type SettingsRow = { leadAssignMode: LeadAssignMode; roundRobinMemberIds: string[] | null; singleAssigneeId: string | null };

/** No row yet means the defaults; an old row may hold NULL for the list, which is an empty list. */
function toSettings(row: SettingsRow | null): LeadAssignmentSettings {
  return {
    leadAssignMode: row?.leadAssignMode ?? "ROUND_ROBIN",
    roundRobinMemberIds: row?.roundRobinMemberIds ?? [],
    singleAssigneeId: row?.singleAssigneeId ?? null,
  };
}

/** The saved choice (or the defaults before anyone has saved one). */
export async function loadLeadAssignmentSettings(
  db: Pick<typeof prisma, "salesSettings"> = prisma,
): Promise<LeadAssignmentSettings> {
  return toSettings(await db.salesSettings.findUnique({ where: { id: "singleton" }, select: SETTINGS_SELECT }));
}

/**
 * Everything the "Who gets new leads" card needs, read without moving the turn.
 * A saved id that is no longer a Sales member is looked up by id alone, so the
 * card can still name someone who lost access; one who left the team has no name.
 */
export async function loadLeadAssignmentView(
  db: Pick<typeof prisma, "salesSettings" | "teamMember"> = prisma,
): Promise<LeadAssignmentView> {
  const [saved, members, effective, firstAdmin] = await Promise.all([
    loadLeadAssignmentSettings(db),
    loadSalesMembers(db),
    loadAssignmentSummary(db),
    // Read the way assignLeadOwner picks its fallback, so the card names the same person.
    db.teamMember.findFirst({ where: { isAdmin: true }, orderBy: FIRST_ADMIN_ORDER, select: { name: true } }),
  ]);

  const nameById = new Map(members.map((member) => [member.id, member.name]));
  const withAccess = new Set(nameById.keys());
  const savedIds = [...saved.roundRobinMemberIds, ...(saved.singleAssigneeId ? [saved.singleAssigneeId] : [])];
  const withoutAccess = [...new Set(savedIds.filter((id) => !withAccess.has(id)))];
  if (withoutAccess.length > 0) {
    const others = await db.teamMember.findMany({ where: { id: { in: withoutAccess } }, select: { id: true, name: true } });
    for (const other of others) nameById.set(other.id, other.name);
  }

  const person = (id: string): SavedPersonView => ({ id, name: nameById.get(id) ?? null, hasAccess: withAccess.has(id) });
  return {
    mode: saved.leadAssignMode,
    members,
    rotation: saved.roundRobinMemberIds.map(person),
    single: saved.singleAssigneeId ? person(saved.singleAssigneeId) : null,
    effective,
    firstAdminName: firstAdmin ? shortName(firstAdmin.name) : null,
  };
}

/** A row id of 1 to 64 characters; anything else is "Invalid input.". */
const recordId = z
  .string({ error: INVALID_INPUT })
  .min(1, { error: INVALID_INPUT })
  .max(ID_MAX, { error: INVALID_INPUT });

/** A save of the "Who gets new leads" card: only what changed. Unknown keys (the cursor included) are refused. */
export const updateSettingsSchema = z
  .strictObject(
    {
      leadAssignMode: z.enum(["ROUND_ROBIN", "SINGLE"], { error: "Pick how new leads are shared out." }).optional(),
      roundRobinMemberIds: z
        .array(recordId, { error: INVALID_INPUT })
        .max(ROTATION_MAX, { error: "Choose up to 100 people." })
        // Someone ticked twice takes one turn.
        .transform((ids) => [...new Set(ids)])
        .optional(),
      singleAssigneeId: recordId.nullable().optional(),
    },
    { error: INVALID_INPUT },
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { error: "Nothing to change." });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/**
 * Saves the mode, the rotation list or the single person, with one history row
 * when something really changed. Everyone the save names must have Sales access
 * (one lookup for all of them); a single person kept from the saved row is
 * checked again, since they may have lost access since (Ruling 24). Refusals
 * about the single person carry `ASSIGNEE_LOST_ACCESS`, so the screen opens the
 * person select.
 */
export async function updateLeadAssignment(
  admin: SalesActor,
  input: UpdateSettingsInput,
  meta: SalesRequestMeta,
): Promise<{ ok: true; settings: LeadAssignmentSettings } | SalesFail> {
  const { leadAssignMode, roundRobinMemberIds, singleAssigneeId } = input;

  const named = [...new Set([...(roundRobinMemberIds ?? []), ...(singleAssigneeId ? [singleAssigneeId] : [])])];
  if (named.length > 0) {
    const found = await prisma.teamMember.findMany({
      where: { id: { in: named }, ...SALES_MEMBER_WHERE },
      select: { id: true },
    });
    const allowed = new Set(found.map((member) => member.id));
    if (named.some((id) => !allowed.has(id))) {
      // When the single person is the one refused, the screen opens the person select.
      const singleRefused = typeof singleAssigneeId === "string" && !allowed.has(singleAssigneeId);
      return fail(400, SALES_ACCESS_ERROR, singleRefused ? "ASSIGNEE_LOST_ACCESS" : undefined);
    }
  }

  return prisma.$transaction(async (tx) => {
    const before = toSettings(await tx.salesSettings.findUnique({ where: { id: "singleton" }, select: SETTINGS_SELECT }));

    // Every check that can refuse runs before the write: a returned refusal still commits.
    const finalMode = leadAssignMode ?? before.leadAssignMode;
    const finalPerson = singleAssigneeId === undefined ? before.singleAssigneeId : singleAssigneeId;
    if (finalMode === "SINGLE" && !finalPerson) return fail(400, SINGLE_MISSING);
    // A person named in this save was checked above; one kept from the saved row may
    // have lost Sales access since, so check them again.
    if (finalMode === "SINGLE" && finalPerson && singleAssigneeId === undefined) {
      const stillMember = await tx.teamMember.findFirst({
        where: { id: finalPerson, ...SALES_MEMBER_WHERE },
        select: { id: true },
      });
      if (!stillMember) return fail(400, SINGLE_LOST_ACCESS, "ASSIGNEE_LOST_ACCESS");
    }

    const changes = { leadAssignMode, roundRobinMemberIds, singleAssigneeId };
    const after = toSettings(
      await tx.salesSettings.upsert({
        where: { id: "singleton" },
        // A new row always gets a real list (never NULL), even when this save leaves it out.
        create: { id: "singleton", ...changes, roundRobinMemberIds: roundRobinMemberIds ?? [] },
        update: changes,
        select: SETTINGS_SELECT,
      }),
    );

    const diff = auditDiff(before, after);
    if (Object.keys(diff.after).length > 0) {
      await recordSalesAudit(tx, admin, { entityType: "SalesSettings", entityId: "singleton", action: "updated", ...diff }, meta);
    }
    return { ok: true as const, settings: after };
  });
}

// --- How long a deal may sit in each stage ---

export type StageSettings = {
  id: string;
  key: string;
  name: string;
  kind: "SALES" | "CONSULTING";
  stages: { id: string; name: string; probability: number; isWon: boolean; isLost: boolean; rottingDays: number | null }[];
};

/** The Sales and Consulting pipelines with their live stages, in board order, for "Pipelines and stages". */
export async function loadStageSettings(db: Pick<typeof prisma, "salesPipeline"> = prisma): Promise<StageSettings[]> {
  const pipelines = await db.salesPipeline.findMany({
    where: { archivedAt: null, kind: { in: [...BOARD_PIPELINE_KINDS] } },
    orderBy: { position: "asc" },
    select: {
      id: true,
      key: true,
      name: true,
      kind: true,
      stages: {
        where: { archivedAt: null },
        orderBy: { position: "asc" },
        select: { id: true, name: true, probability: true, isWon: true, isLost: true, rottingDays: true },
      },
    },
  });
  // The query already keeps only these two kinds; this tells the type the same.
  return pipelines.flatMap((pipeline) => (pipeline.kind === "DELIVERY" ? [] : [{ ...pipeline, kind: pipeline.kind }]));
}

const rottingDays = z
  .number({ error: ROTTING_ERROR })
  .int({ error: ROTTING_ERROR })
  .min(1, { error: ROTTING_ERROR })
  .max(ROTTING_DAYS_MAX, { error: ROTTING_ERROR })
  .nullable();

/** The "Edit stages" dialog's save: rotting days only (no rename, probability or order; A8). Blank (null) means never. */
export const stageRottingSchema = z.strictObject(
  {
    stages: z
      .array(z.strictObject({ id: recordId, rottingDays }, { error: INVALID_INPUT }), { error: INVALID_INPUT })
      .min(1, { error: INVALID_INPUT })
      .max(STAGES_PER_SAVE_MAX, { error: INVALID_INPUT })
      // One number per stage: a stage sent twice is a broken request, not a choice.
      .refine((stages) => new Set(stages.map((stage) => stage.id)).size === stages.length, { error: INVALID_INPUT }),
  },
  { error: INVALID_INPUT },
);

export type StageRottingInput = z.infer<typeof stageRottingSchema>;

/**
 * Saves each stage's rotting days for one Sales or Consulting pipeline, in one
 * transaction: every refusal first (a missing pipeline, a stage of another
 * pipeline, a number on a won or lost stage), then one update and one `updated`
 * history row (entity `SalesStage`) per stage whose number changed. Answers with
 * the stages as sent.
 */
export async function updateStageRotting(
  admin: SalesActor,
  pipelineId: string,
  input: StageRottingInput,
  meta: SalesRequestMeta,
): Promise<{ ok: true; stages: { id: string; rottingDays: number | null }[] } | SalesFail> {
  if (pipelineId.length === 0 || pipelineId.length > ID_MAX) return fail(404, PIPELINE_NOT_FOUND);

  return prisma.$transaction(async (tx) => {
    const pipeline = await tx.salesPipeline.findFirst({
      where: { id: pipelineId, archivedAt: null, kind: { in: [...BOARD_PIPELINE_KINDS] } },
      select: {
        id: true,
        stages: { where: { archivedAt: null }, select: { id: true, isWon: true, isLost: true, rottingDays: true } },
      },
    });
    if (!pipeline) return fail(404, PIPELINE_NOT_FOUND);

    const savedById = new Map(pipeline.stages.map((stage) => [stage.id, stage]));
    const changed: { id: string; before: number | null; after: number | null }[] = [];
    for (const { id, rottingDays: next } of input.stages) {
      const saved = savedById.get(id);
      if (!saved) return fail(400, STAGE_NOT_IN_PIPELINE);
      if ((saved.isWon || saved.isLost) && next !== null) return fail(400, CLOSED_STAGES_NEVER_ROT);
      if (saved.rottingDays !== next) changed.push({ id, before: saved.rottingDays, after: next });
    }

    for (const { id, before, after } of changed) {
      await tx.salesStage.update({ where: { id }, data: { rottingDays: after } });
      await recordSalesAudit(
        tx,
        admin,
        { entityType: "SalesStage", entityId: id, action: "updated", before: { rottingDays: before }, after: { rottingDays: after } },
        meta,
      );
    }
    return { ok: true as const, stages: input.stages.map(({ id, rottingDays: days }) => ({ id, rottingDays: days })) };
  });
}
