// The first two steps of a Pipedrive import run. "users" works out which team
// member each Pipedrive user becomes. "structure" matches Pipedrive's
// pipelines, stages and custom fields to the app's (by name key), creates the
// ones the app does not have (a practice run only reports them), and keeps the
// result in the run's cursor so the later steps can use it. A Pipedrive custom
// field is shared by its deals and its leads, so each one is matched twice, to
// a deal field and to a lead field, and whichever is missing is created. Both steps are
// small, so each runs in one go: every list is read before anything is written,
// so a rate limit mid-step leaves nothing half done.

import { prisma } from "@/lib/prisma";
import { SALES_MEMBER_WHERE } from "@/lib/sales/access";
import { TITLE_MAX } from "@/lib/sales/constants";
import { nameKey } from "@/lib/sales/contact-keys";
import type { PagesOptions, PipedriveClient } from "@/lib/sales/pipedrive/client";
import {
  appFieldType,
  matchPipedriveUsers,
  optionLabels,
  planStages,
  uniqueKey,
  type PipedriveStage,
} from "@/lib/sales/pipedrive/import-decide";
import { bump, type FieldLink, type PhaseResult, type PhaseWork } from "@/lib/sales/pipedrive/import-state";
import { kebab } from "@/lib/sales/seed-data";

/** Lists this small fit on one page at Pipedrive's largest page size. */
const SMALL_LIST_LIMIT = 500;
/** A custom field key in Pipedrive is 40 hex characters; built-in fields have plain names. */
const CUSTOM_FIELD_KEY = /^[0-9a-f]{40}$/;

/** Every row of a list, all pages. */
export async function readAll<T>(client: PipedriveClient, path: string, opts: PagesOptions = {}): Promise<T[]> {
  const rows: T[] = [];
  for await (const batch of client.pageBatches<T>(path, opts)) rows.push(...batch.items);
  return rows;
}

type PipedriveUser = { id: number; name?: string | null; email?: string | null };

export async function runUsersPhase(work: PhaseWork): Promise<PhaseResult> {
  const users = (await readAll<PipedriveUser>(work.client, "/v1/users", { style: "offset" })).filter(
    (user) => typeof user?.id === "number",
  );
  const [members, overrides] = await Promise.all([
    prisma.teamMember.findMany({ where: SALES_MEMBER_WHERE, select: { id: true, name: true, email: true } }),
    prisma.salesImportUserMap.findMany({ select: { pipedriveUserId: true, memberId: true } }),
  ]);

  const matches = matchPipedriveUsers(users, members, overrides);
  work.cursor.context.users = matches.map((m) => ({ id: m.pipedriveUserId, name: m.name, email: m.email, memberId: m.memberId }));
  bump(work.counts, "users.seen", matches.length);
  for (const m of matches) {
    if (m.memberId !== null) continue;
    bump(work.counts, "users.unmatched");
    work.issues.add(
      {
        phase: "users",
        pipedriveId: m.pipedriveUserId,
        message: `The Pipedrive user ${m.name} (${m.email ?? "no email"}) matches no team member, so their records go to the person who started the import.`,
      },
      { exact: true },
    );
  }
  return "finished";
}

type PipedrivePipeline = { id: number; name?: string | null; order_nr?: number | null; is_deleted?: boolean | null };
type PipedriveField = {
  key?: string | null;
  name?: string | null;
  field_type?: string | null;
  options?: unknown;
  active_flag?: boolean | null;
};

export async function runStructurePhase(work: PhaseWork): Promise<PhaseResult> {
  const pipelines = await readAll<PipedrivePipeline>(work.client, "/api/v2/pipelines", { limit: SMALL_LIST_LIMIT });
  const stages = await readAll<PipedriveStage>(work.client, "/api/v2/stages", { limit: SMALL_LIST_LIMIT });
  const fields = await readAll<PipedriveField>(work.client, "/v1/dealFields", { style: "offset", limit: SMALL_LIST_LIMIT });

  await syncPipelines(
    work,
    pipelines.filter((p) => typeof p?.id === "number" && p.is_deleted !== true),
    stages.filter((s) => typeof s?.id === "number" && s.is_deleted !== true),
  );
  await syncFields(
    work,
    fields.filter((f) => typeof f?.key === "string" && CUSTOM_FIELD_KEY.test(f.key) && f.active_flag !== false),
  );
  return "finished";
}

function displayName(name: string | null | undefined, blank: string): string {
  return (name?.trim() || blank).slice(0, TITLE_MAX);
}

async function syncPipelines(work: PhaseWork, pdPipelines: PipedrivePipeline[], pdStages: PipedriveStage[]): Promise<void> {
  const ctx = work.cursor.context;
  const done = work.live ? "was" : "would be";
  const appPipelines = await prisma.salesPipeline.findMany({ select: { id: true, key: true, name: true, position: true, archivedAt: true } });
  const appStages = await prisma.salesStage.findMany({
    select: { id: true, pipelineId: true, key: true, name: true, position: true, isWon: true, isLost: true, archivedAt: true },
  });
  const pipelineKeys = new Set(appPipelines.map((p) => p.key));
  let nextPosition = Math.max(0, ...appPipelines.map((p) => p.position)) + 1;
  ctx.stages = {};
  ctx.pipelines = {};

  const ordered = [...pdPipelines].sort((a, b) => (a.order_nr ?? 0) - (b.order_nr ?? 0) || a.id - b.id);
  for (const pd of ordered) {
    bump(work.counts, "pipelines.seen");
    const name = displayName(pd.name, "Unnamed pipeline");
    const match = appPipelines.find((p) => p.archivedAt === null && nameKey(p.name) === nameKey(name));
    let pipelineId = match?.id ?? null;
    if (match) {
      bump(work.counts, "pipelines.unchanged");
    } else {
      bump(work.counts, "pipelines.created");
      work.issues.add(
        { phase: "structure", pipedriveId: pd.id, message: `The Pipedrive pipeline "${name}" has no match in the app, so it ${done} created as a sales pipeline.` },
        { exact: true },
      );
      if (work.live) {
        const created = await prisma.salesPipeline.create({
          data: { key: uniqueKey(kebab(name), pipelineKeys, "pipeline"), name, kind: "SALES", position: nextPosition++ },
          select: { id: true, key: true },
        });
        pipelineId = created.id;
        // Known from now on, so a second Pipedrive pipeline of the same name matches it instead of making another.
        appPipelines.push({ id: created.id, key: created.key, name, position: nextPosition - 1, archivedAt: null });
      }
    }

    const own = pipelineId === null ? [] : appStages.filter((s) => s.pipelineId === pipelineId);
    const mine = pdStages.filter((s) => s.pipeline_id === pd.id);
    const plan = planStages(own, mine);
    bump(work.counts, "stages.seen", mine.length);
    bump(work.counts, "stages.unchanged", Object.keys(plan.matched).length);
    bump(work.counts, "stages.created", plan.creates.length);
    for (const c of plan.creates) {
      work.issues.add(
        { phase: "structure", pipedriveId: c.pipedriveId, message: `The Pipedrive stage "${c.name}" in ${name} has no match in the app, so it ${done} created.` },
        { exact: true },
      );
    }

    const createdIds = new Map<string, string>();
    if (work.live && pipelineId !== null && plan.creates.length > 0) {
      const id = pipelineId;
      // One transaction: the won and lost stages move down and the new ones go in, or neither happens.
      await prisma.$transaction(async (tx) => {
        if (plan.shiftFrom !== null) {
          await tx.salesStage.updateMany({
            where: { pipelineId: id, position: { gte: plan.shiftFrom } },
            data: { position: { increment: plan.creates.length } },
          });
        }
        await tx.salesStage.createMany({
          data: plan.creates.map((c) => ({
            pipelineId: id,
            key: c.key,
            name: c.name,
            position: c.position,
            probability: c.probability,
            rottingDays: c.rottingDays,
            // A new stage is always an open one: it goes before the won and lost stages.
            isWon: false,
            isLost: false,
          })),
        });
      });
      const fresh = await prisma.salesStage.findMany({
        where: { pipelineId: id, key: { in: plan.creates.map((c) => c.key) } },
        select: { id: true, key: true },
      });
      for (const row of fresh) createdIds.set(row.key, row.id);
      // Keep the in-memory list in step with the database for a later Pipedrive pipeline that lands here too.
      const shiftFrom = plan.shiftFrom;
      if (shiftFrom !== null) for (const s of own) if (s.position >= shiftFrom) s.position += plan.creates.length;
      for (const c of plan.creates) {
        const stageId = createdIds.get(c.key);
        if (stageId) appStages.push({ id: stageId, pipelineId: id, key: c.key, name: c.name, position: c.position, isWon: false, isLost: false, archivedAt: null });
      }
    }

    for (const [pdStageId, stageId] of Object.entries(plan.matched)) ctx.stages[pdStageId] = { stageId, pipelineId };
    for (const c of plan.creates) ctx.stages[String(c.pipedriveId)] = { stageId: createdIds.get(c.key) ?? null, pipelineId };
    const firstOpen = own
      .filter((s) => s.archivedAt === null && !s.isWon && !s.isLost)
      .sort((a, b) => a.position - b.position)[0];
    const firstCreated = plan.creates[0] ? (createdIds.get(plan.creates[0].key) ?? null) : null;
    ctx.pipelines[String(pd.id)] = { pipelineId, firstStageId: firstOpen?.id ?? firstCreated };
  }
}

async function syncFields(work: PhaseWork, pdFields: PipedriveField[]): Promise<void> {
  const ctx = work.cursor.context;
  const done = work.live ? "was" : "would be";
  const appFields = await prisma.salesCustomField.findMany({
    select: { id: true, key: true, label: true, entity: true, position: true, archivedAt: true },
  });
  const keys = new Set(appFields.map((f) => f.key));
  let nextPosition = Math.max(0, ...appFields.map((f) => f.position)) + 1;
  const findField = (entity: "DEAL" | "LEAD", key: string | null) =>
    key === null ? undefined : appFields.find((f) => f.archivedAt === null && f.entity === entity && nameKey(f.label) === key);

  ctx.fields = {};
  type FieldCreate = { pdKeys: string[]; key: string; label: string; fieldType: ReturnType<typeof appFieldType>; options: string[]; position: number };
  const dealCreates: FieldCreate[] = [];
  const leadCreates: FieldCreate[] = [];
  // New fields by name key, so a second Pipedrive field of the same name shares the one being made.
  const pendingDeal = new Map<string, FieldCreate>();
  const pendingLead = new Map<string, FieldCreate>();
  for (const pd of pdFields) {
    const pdKey = pd.key as string;
    bump(work.counts, "customFields.seen");
    const name = displayName(pd.name, "Unnamed field");
    const key = nameKey(name);
    const options = pd.field_type === "enum" || pd.field_type === "set" ? (optionLabels(pd.options) ?? {}) : null;
    const deal = findField("DEAL", key);
    const lead = findField("LEAD", key);
    const link: FieldLink = { name, options, dealFieldId: deal?.id ?? null, leadFieldId: lead?.id ?? null };
    ctx.fields[pdKey] = link;
    const fieldType = appFieldType(pd.field_type);
    const make = (newKey: string): FieldCreate => ({
      pdKeys: [pdKey],
      key: newKey,
      label: name,
      fieldType,
      options: fieldType === "SELECT" && options ? Object.values(options) : [],
      position: nextPosition++,
    });

    let createdAny = false;
    if (!deal) {
      const twin = key === null ? undefined : pendingDeal.get(key);
      if (twin) {
        twin.pdKeys.push(pdKey);
      } else {
        createdAny = true;
        work.issues.add(
          { phase: "structure", pipedriveId: null, message: `The Pipedrive deal field "${name}" has no match in the app, so it ${done} created.` },
          { exact: true },
        );
        const create = make(uniqueKey(kebab(name), keys, "field"));
        dealCreates.push(create);
        if (key !== null) pendingDeal.set(key, create);
      }
    }
    if (!lead) {
      // A practice run makes nothing, so the rows step is told the lead field is coming and does not call its values lost.
      if (!work.live) link.leadFieldPlanned = true;
      const twin = key === null ? undefined : pendingLead.get(key);
      if (twin) {
        twin.pdKeys.push(pdKey);
      } else {
        createdAny = true;
        bump(work.counts, "customFields.leadCreated");
        work.issues.add(
          {
            phase: "structure",
            pipedriveId: null,
            message: `The Pipedrive field "${name}" has no lead field in the app, so a lead field ${done} created for its values on leads.`,
          },
          { exact: true },
        );
        const create = make(uniqueKey(leadKeyBase(name, keys), keys, "field"));
        leadCreates.push(create);
        if (key !== null) pendingLead.set(key, create);
      }
    }
    bump(work.counts, createdAny ? "customFields.created" : "customFields.unchanged");
  }

  if (!work.live || dealCreates.length + leadCreates.length === 0) return;
  await prisma.salesCustomField.createMany({
    data: [
      ...dealCreates.map((c) => ({ ...fieldRow(c), entity: "DEAL" as const })),
      ...leadCreates.map((c) => ({ ...fieldRow(c), entity: "LEAD" as const })),
    ],
  });
  const fresh = await prisma.salesCustomField.findMany({
    where: { key: { in: [...dealCreates, ...leadCreates].map((c) => c.key) } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(fresh.map((f) => [f.key, f.id]));
  for (const c of dealCreates) for (const pdKey of c.pdKeys) ctx.fields[pdKey].dealFieldId = idByKey.get(c.key) ?? null;
  for (const c of leadCreates) for (const pdKey of c.pdKeys) ctx.fields[pdKey].leadFieldId = idByKey.get(c.key) ?? null;
}

function fieldRow(c: { key: string; label: string; fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT"; options: string[]; position: number }) {
  return { key: c.key, label: c.label, fieldType: c.fieldType, options: c.options, pipelineKeys: [] as string[], position: c.position };
}

/**
 * Where a new lead field's key starts. A custom field's key is unique across
 * deal and lead fields, and the deal field of the same name usually holds the
 * plain name already, so the lead field takes "-lead" after it. The screens
 * never show a key; it only has to be unique and the same on every run.
 */
function leadKeyBase(name: string, taken: Set<string>): string {
  const base = kebab(name) || "field";
  return taken.has(base) ? `${base}-lead` : base;
}
