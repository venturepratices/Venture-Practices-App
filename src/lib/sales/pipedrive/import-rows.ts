// The record steps of a Pipedrive import run: organizations, persons, deals,
// leads, activities and notes, in that order, so every link points at a row an
// earlier step already copied. Each Pipedrive page is one batch: map the
// records, look up the app rows they link to and the rows already copied (one
// query per kind, never one per row), then write only what is new or changed,
// in transactions of at most 100 rows, with the history rows for deals and
// leads in the same transaction. The page's place is saved after it is written,
// so a resume never reads a finished page again.
//
// Rows are written with Prisma directly, never through the app's own actions,
// so no rule fires, no lead is assigned, and nobody gets a message.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordSalesAuditMany, type SalesAuditEntry } from "@/lib/sales/audit";
import type { PageToken } from "@/lib/sales/pipedrive/client";
import {
  activityTarget,
  changedFields,
  convertCustomValue,
  isMidnightDueTime,
  keepGuessedValues,
  resolveDealStage,
  resolveLink,
  resolveOwner,
} from "@/lib/sales/pipedrive/import-decide";
import { bump, type Counts, type ImportPhase, type PhaseResult, type PhaseWork } from "@/lib/sales/pipedrive/import-state";
import {
  mapActivity,
  mapDeal,
  mapLead,
  mapNote,
  mapOrganization,
  mapPerson,
  type MapSkip,
  type PipedriveActivity,
  type PipedriveDeal,
  type PipedriveLead,
  type PipedriveNote,
  type PipedriveOrganization,
  type PipedrivePerson,
} from "@/lib/sales/pipedrive/map";

export type RowPhase = "organizations" | "persons" | "deals" | "leads" | "activities" | "notes";

type Source = { path: string; style: "cursor" | "offset"; archived?: boolean };

/**
 * Where each step reads. Pipedrive lists archived deals and archived leads
 * separately from the rest, so those steps read two lists.
 */
export const ROW_SOURCES: Record<RowPhase, Source[]> = {
  organizations: [{ path: "/api/v2/organizations", style: "cursor" }],
  persons: [{ path: "/api/v2/persons", style: "cursor" }],
  deals: [
    { path: "/api/v2/deals", style: "cursor" },
    { path: "/api/v2/deals/archived", style: "cursor", archived: true },
  ],
  leads: [
    { path: "/api/v1/leads", style: "offset" },
    { path: "/api/v1/leads/archived", style: "offset", archived: true },
  ],
  activities: [{ path: "/api/v2/activities", style: "cursor" }],
  notes: [{ path: "/api/v1/notes", style: "offset" }],
};

/** Rows per Pipedrive page, and so per batch. */
export const PAGE_LIMIT = 100;
/** The most rows one transaction writes. */
const BATCH_MAX = 100;
const TRANSACTION = { timeout: 30_000, maxWait: 5_000 };
const IMPORT_ACTOR = { system: "import" } as const;
/** `createdBy` on every imported activity. */
export const IMPORTED_BY = "import:pipedrive";

const TABLE = {
  organizations: "salesOrganization",
  persons: "salesPerson",
  deals: "salesDeal",
  leads: "salesLead",
  activities: "salesActivity",
  notes: "salesNote",
} as const;
type RowTable = (typeof TABLE)[RowPhase];

/** The few calls the generic writer makes, the same on every table it writes. */
type LooseDelegate = {
  findMany(args: object): Promise<Record<string, unknown>[]>;
  createMany(args: object): Promise<{ count: number }>;
  update(args: object): Promise<unknown>;
};
type Db = typeof prisma | Prisma.TransactionClient;

function table(db: Db, name: RowTable): LooseDelegate {
  return db[name] as unknown as LooseDelegate;
}

/** One row a page wants in the app. */
type Plan = {
  pipedriveId: number | string;
  /** Compared on a re-run, and written when they differ. */
  values: Record<string, unknown>;
  /** Written only when the row is created. */
  createOnly: Record<string, unknown>;
  /** Custom field values (deals and leads, real runs only). */
  custom: { fieldId: string; value: string }[];
};

/** What one page adds to the run. Kept apart until the page is written, so a page given up halfway leaves no trace in the report. */
type PageLog = { counts: Counts; issues: { pipedriveId: number | string | null; message: string; exact: boolean }[] };

export async function runRowPhase(phase: RowPhase, work: PhaseWork): Promise<PhaseResult> {
  const sources = ROW_SOURCES[phase];
  while (work.cursor.source < sources.length) {
    const source = sources[work.cursor.source];
    const resumeAt: PageToken | null = work.cursor.page;
    const batches = work.client.pageBatches<Record<string, unknown>>(source.path, {
      style: source.style,
      limit: PAGE_LIMIT,
      ...(resumeAt ? { resumeAt } : {}),
    });
    try {
      for (;;) {
        if (work.outOfTime()) return "stopped";
        const next = await batches.next();
        const items = next.done ? [] : next.value.items;
        const nextPage = next.done ? null : next.value.resumeAt;
        const rows = source.archived ? items.map((item) => ({ ...item, is_archived: true })) : items;

        const log: PageLog = { counts: {}, issues: [] };
        if (!(await importPage(phase, rows, work, log))) return "stopped";
        for (const [key, by] of Object.entries(log.counts)) work.counts[key] = (work.counts[key] ?? 0) + by;
        for (const issue of log.issues) work.issues.add({ phase, pipedriveId: issue.pipedriveId, message: issue.message }, { exact: issue.exact });

        work.cursor.page = nextPage;
        if (nextPage === null) work.cursor.source += 1;
        if (!(await work.save())) return "stopped";
        if (nextPage === null) break;
      }
    } finally {
      await batches.return(undefined);
    }
  }
  return "finished";
}

// --- One page ---

type Mapped<P extends RowPhase> = {
  organizations: Exclude<ReturnType<typeof mapOrganization>, MapSkip>;
  persons: Exclude<ReturnType<typeof mapPerson>, MapSkip>;
  deals: Exclude<ReturnType<typeof mapDeal>, MapSkip>;
  leads: Exclude<ReturnType<typeof mapLead>, MapSkip>;
  activities: Exclude<ReturnType<typeof mapActivity>, MapSkip>;
  notes: Exclude<ReturnType<typeof mapNote>, MapSkip>;
}[P];

/** The page's records through the mapper. Skipped ones are counted, with the mapper's reason as the issue. */
function mapPage<P extends RowPhase>(phase: P, rows: Record<string, unknown>[], work: PhaseWork, log: PageLog): Mapped<P>[] {
  const out: Mapped<P>[] = [];
  for (const row of rows) {
    const result = mapOne(phase, row, work.fallback);
    const pipedriveId = (typeof row.id === "number" || typeof row.id === "string" ? row.id : null) as number | string | null;
    if ("skip" in result) {
      bump(log.counts, `${phase}.skipped`);
      log.issues.push({ pipedriveId, message: result.reason, exact: false });
      continue;
    }
    for (const message of result.issues) log.issues.push({ pipedriveId: result.pipedriveId, message, exact: false });
    out.push(result as Mapped<P>);
  }
  return out;
}

function mapOne(phase: RowPhase, row: Record<string, unknown>, fallback: Date) {
  switch (phase) {
    case "organizations":
      return mapOrganization(row as unknown as PipedriveOrganization, fallback);
    case "persons":
      return mapPerson(row as unknown as PipedrivePerson, fallback);
    case "deals":
      return mapDeal(row as unknown as PipedriveDeal, fallback);
    case "leads":
      return mapLead(row as unknown as PipedriveLead, fallback);
    case "activities":
      return mapActivity(row as unknown as PipedriveActivity, fallback);
    case "notes":
      return mapNote(row as unknown as PipedriveNote, fallback);
  }
}

/** Returns false when the page was given up between batches (out of time); its place is then not moved. */
async function importPage(phase: RowPhase, rows: Record<string, unknown>[], work: PhaseWork, log: PageLog): Promise<boolean> {
  bump(log.counts, `${phase}.seen`, rows.length);
  if (phase === "activities") {
    // Always present (0 too), so the report can say none were found rather than nothing.
    log.counts.activitiesAtMidnightUtc = rows.filter((row) => isMidnightDueTime(row.due_time)).length;
  }
  const plans = await planPage(phase, rows, work, log);
  return writePlans(phase, plans, work, log);
}

async function planPage(phase: RowPhase, rows: Record<string, unknown>[], work: PhaseWork, log: PageLog): Promise<Plan[]> {
  const owners = new Map(work.cursor.context.users.flatMap((u) => (u.memberId ? [[u.id, u.memberId] as const] : [])));
  const owner = (pipedriveId: number | string, userId: number | null, role: "owner" | "author" = "owner") => {
    const result = resolveOwner(userId, owners, work.starterId, role);
    if (result.issue) log.issues.push({ pipedriveId, message: result.issue, exact: false });
    return result.memberId;
  };
  const note = (pipedriveId: number | string, message: string | null, exact = false) => {
    if (message) log.issues.push({ pipedriveId, message, exact });
  };
  const skip = (pipedriveId: number | string, message: string) => {
    bump(log.counts, `${phase}.skipped`);
    note(pipedriveId, message);
  };
  const plan = (pipedriveId: number | string, values: Record<string, unknown>, createOnly: Record<string, unknown>, custom: Plan["custom"] = []) => ({
    pipedriveId,
    values,
    createOnly,
    custom,
  });
  const live = work.live;

  switch (phase) {
    case "organizations": {
      return mapPage(phase, rows, work, log).map((m) => {
        const { createdAt, ...fields } = m.fields;
        return plan(m.pipedriveId, { ...fields, ownerId: owner(m.pipedriveId, m.links.ownerPipedriveUserId) }, { createdAt });
      });
    }

    case "persons": {
      const mapped = mapPage(phase, rows, work, log);
      const orgs = live ? await lookup("salesOrganization", mapped.map((m) => m.links.organizationPipedriveId)) : null;
      return mapped.map((m) => {
        const { createdAt, ...fields } = m.fields;
        const values: Record<string, unknown> = { ...fields, ownerId: owner(m.pipedriveId, m.links.ownerPipedriveUserId) };
        if (orgs) {
          const org = resolveLink(m.links.organizationPipedriveId, orgs, "The person's organization was not copied, so the link was left out.");
          note(m.pipedriveId, org.issue);
          values.organizationId = org.id;
        }
        return plan(m.pipedriveId, values, { createdAt });
      });
    }

    case "deals": {
      const mapped = mapPage(phase, rows, work, log);
      const people = live ? await lookup("salesPerson", mapped.map((m) => m.links.personPipedriveId)) : null;
      const orgs = live ? await lookup("salesOrganization", mapped.map((m) => m.links.organizationPipedriveId)) : null;
      return mapped.flatMap((m) => {
        const stage = resolveDealStage(m.links.stagePipedriveId, m.links.pipelinePipedriveId, work.cursor.context, live);
        if ("skip" in stage) {
          skip(m.pipedriveId, stage.skip);
          return [];
        }
        note(m.pipedriveId, stage.issue);
        const { createdAt, ...fields } = m.fields;
        const values: Record<string, unknown> = { ...fields, ownerId: owner(m.pipedriveId, m.links.ownerPipedriveUserId) };
        if (people && orgs) {
          const person = resolveLink(m.links.personPipedriveId, people, "The deal's person was not copied, so the link was left out.");
          const org = resolveLink(m.links.organizationPipedriveId, orgs, "The deal's organization was not copied, so the link was left out.");
          note(m.pipedriveId, person.issue);
          note(m.pipedriveId, org.issue);
          Object.assign(values, { personId: person.id, organizationId: org.id, pipelineId: stage.pipelineId, stageId: stage.stageId });
        }
        return [plan(m.pipedriveId, values, { createdAt }, customValues(m.pipedriveId, m.customFields, "deal", work, log))];
      });
    }

    case "leads": {
      const mapped = mapPage(phase, rows, work, log);
      const people = live ? await lookup("salesPerson", mapped.map((m) => m.links.personPipedriveId)) : null;
      const orgs = live ? await lookup("salesOrganization", mapped.map((m) => m.links.organizationPipedriveId)) : null;
      return mapped.map((m) => {
        const { createdAt, ...fields } = m.fields;
        const values: Record<string, unknown> = { ...fields, ownerId: owner(m.pipedriveId, m.links.ownerPipedriveUserId) };
        if (people && orgs) {
          const person = resolveLink(m.links.personPipedriveId, people, "The lead's person was not copied, so the link was left out.");
          const org = resolveLink(m.links.organizationPipedriveId, orgs, "The lead's organization was not copied, so the link was left out.");
          note(m.pipedriveId, person.issue);
          note(m.pipedriveId, org.issue);
          Object.assign(values, { personId: person.id, organizationId: org.id });
        }
        return plan(m.pipedriveId, values, { createdAt }, customValues(m.pipedriveId, m.customFields, "lead", work, log));
      });
    }

    case "activities": {
      const mapped = mapPage(phase, rows, work, log);
      if (!live) {
        // A practice run cannot check links (nothing is copied yet), only that there is something to link to.
        return mapped.flatMap((m) => {
          const { dealPipedriveId, leadPipedriveId, personPipedriveId, organizationPipedriveId } = m.links;
          if (dealPipedriveId === null && leadPipedriveId === null && personPipedriveId === null && organizationPipedriveId === null) {
            skip(m.pipedriveId, "The activity was not on a deal, lead or person that was copied, so it was not copied.");
            return [];
          }
          const { createdAt, ...fields } = m.fields;
          return [plan(m.pipedriveId, { ...fields, ownerId: owner(m.pipedriveId, m.links.ownerPipedriveUserId) }, { createdAt, createdBy: IMPORTED_BY })];
        });
      }
      const deals = await lookup("salesDeal", mapped.map((m) => m.links.dealPipedriveId));
      const leads = await lookup("salesLead", mapped.map((m) => m.links.leadPipedriveId));
      const people = await lookup("salesPerson", mapped.map((m) => m.links.personPipedriveId));
      const orgs = await lookup("salesOrganization", mapped.map((m) => m.links.organizationPipedriveId));
      const resolved = mapped.map((m) => {
        const deal = resolveLink(m.links.dealPipedriveId, deals, "The activity's deal was not copied, so the link was left out.");
        const lead = resolveLink(m.links.leadPipedriveId, leads, "The activity's lead was not copied, so the link was left out.");
        const person = resolveLink(m.links.personPipedriveId, people, "The activity's person was not copied, so the link was left out.");
        const org = resolveLink(m.links.organizationPipedriveId, orgs, "The activity's organization was not copied, so the link was left out.");
        for (const link of [deal, lead, person, org]) note(m.pipedriveId, link.issue);
        return { m, dealId: deal.id, leadId: lead.id, personId: person.id, orgId: org.id };
      });
      const firstPeople = await firstPersonOf(resolved.filter((r) => !r.dealId && !r.leadId && !r.personId).map((r) => r.orgId));
      return resolved.flatMap(({ m, dealId, leadId, personId, orgId }) => {
        const target = activityTarget({ dealId, leadId, personId }, orgId ? { firstPersonId: firstPeople.get(orgId) ?? null } : null);
        if ("skip" in target) {
          skip(m.pipedriveId, target.skip);
          return [];
        }
        note(m.pipedriveId, target.issue);
        const { createdAt, ...fields } = m.fields;
        const values = { ...fields, ownerId: owner(m.pipedriveId, m.links.ownerPipedriveUserId), dealId, leadId, personId: target.personId };
        return [plan(m.pipedriveId, values, { createdAt, createdBy: IMPORTED_BY })];
      });
    }

    case "notes": {
      const mapped = mapPage(phase, rows, work, log);
      const nothing = "The note was not on anything that was copied, so it was not copied.";
      if (!live) {
        return mapped.flatMap((m) => {
          if (Object.entries(m.links).every(([key, value]) => key === "ownerPipedriveUserId" || value === null)) {
            skip(m.pipedriveId, nothing);
            return [];
          }
          const { createdAt, ...fields } = m.fields;
          return [plan(m.pipedriveId, { ...fields, authorId: owner(m.pipedriveId, m.links.ownerPipedriveUserId, "author") }, { createdAt })];
        });
      }
      const deals = await lookup("salesDeal", mapped.map((m) => m.links.dealPipedriveId));
      const leads = await lookup("salesLead", mapped.map((m) => m.links.leadPipedriveId));
      const people = await lookup("salesPerson", mapped.map((m) => m.links.personPipedriveId));
      const orgs = await lookup("salesOrganization", mapped.map((m) => m.links.organizationPipedriveId));
      return mapped.flatMap((m) => {
        const deal = resolveLink(m.links.dealPipedriveId, deals, "The note's deal was not copied, so the link was left out.");
        const lead = resolveLink(m.links.leadPipedriveId, leads, "The note's lead was not copied, so the link was left out.");
        const person = resolveLink(m.links.personPipedriveId, people, "The note's person was not copied, so the link was left out.");
        const org = resolveLink(m.links.organizationPipedriveId, orgs, "The note's organization was not copied, so the link was left out.");
        for (const link of [deal, lead, person, org]) note(m.pipedriveId, link.issue);
        if (!deal.id && !lead.id && !person.id && !org.id) {
          skip(m.pipedriveId, nothing);
          return [];
        }
        const { createdAt, ...fields } = m.fields;
        const values = {
          ...fields,
          authorId: owner(m.pipedriveId, m.links.ownerPipedriveUserId, "author"),
          dealId: deal.id,
          leadId: lead.id,
          personId: person.id,
          organizationId: org.id,
        };
        return [plan(m.pipedriveId, values, { createdAt })];
      });
    }
  }
}

/** App ids of already copied rows by their Pipedrive id, in one query. */
async function lookup(name: RowTable, pipedriveIds: (number | string | null)[]): Promise<Map<number | string, string>> {
  const ids = [...new Set(pipedriveIds.filter((id): id is number | string => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await table(prisma, name).findMany({ where: { pipedriveId: { in: ids } }, select: { id: true, pipedriveId: true } });
  return new Map(rows.map((row) => [row.pipedriveId as number | string, row.id as string]));
}

/** Each organization's first person (the earliest added), in one query. */
async function firstPersonOf(orgIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(orgIds.filter((id): id is string => id !== null))];
  const first = new Map<string, string>();
  if (ids.length === 0) return first;
  const people = await prisma.salesPerson.findMany({
    where: { organizationId: { in: ids }, archivedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, organizationId: true },
  });
  for (const person of people) if (person.organizationId && !first.has(person.organizationId)) first.set(person.organizationId, person.id);
  return first;
}

/** A deal's or lead's custom values as the app stores them, with an issue for each one that cannot be kept. */
function customValues(
  pipedriveId: number | string,
  raw: Record<string, string>,
  kind: "deal" | "lead",
  work: PhaseWork,
  log: PageLog,
): Plan["custom"] {
  const out: Plan["custom"] = [];
  for (const [key, text] of Object.entries(raw)) {
    const field = work.cursor.context.fields[key];
    if (!field) {
      log.issues.push({ pipedriveId, exact: false, message: "A value in a Pipedrive field that is no longer in use was not copied." });
      continue;
    }
    if (kind === "lead" && field.leadFieldId === null) {
      log.issues.push({
        pipedriveId,
        exact: true,
        message: `The Pipedrive field "${field.name}" has no lead field in the app, so its values on leads were not copied.`,
      });
      continue;
    }
    const converted = convertCustomValue(text, field);
    if (converted.issue) log.issues.push({ pipedriveId, exact: true, message: converted.issue });
    const fieldId = kind === "deal" ? field.dealFieldId : field.leadFieldId;
    if (converted.value !== null && fieldId !== null && work.live) out.push({ fieldId, value: converted.value });
  }
  return out;
}

// --- Writing ---

type CustomChange = { creates: { fieldId: string; value: string }[]; updates: { id: string; value: string }[] };

function jsonable(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}

/** Compares the page with what is already copied, then writes only what is new or changed (nothing in a practice run). */
async function writePlans(phase: RowPhase, plans: Plan[], work: PhaseWork, log: PageLog): Promise<boolean> {
  if (plans.length === 0) return true;
  const name = TABLE[phase];
  const keys = [...new Set(plans.flatMap((p) => Object.keys(p.values)))];
  const existing = await table(prisma, name).findMany({
    where: { pipedriveId: { in: plans.map((p) => p.pipedriveId) } },
    select: Object.fromEntries([["id", true], ["pipedriveId", true], ...keys.map((key) => [key, true])]),
  });
  const byPipedriveId = new Map(existing.map((row) => [row.pipedriveId as number | string, row]));

  // Custom values already stored on the rows that exist.
  const parent = phase === "deals" ? "dealId" : phase === "leads" ? "leadId" : null;
  const storedValues = new Map<string, { id: string; value: string }>();
  if (parent && work.live && existing.length > 0) {
    const values = await prisma.salesCustomFieldValue.findMany({
      where: { [parent]: { in: existing.map((row) => row.id as string) } },
      select: { id: true, fieldId: true, dealId: true, leadId: true, value: true },
    });
    for (const v of values) storedValues.set(`${v.fieldId}|${(parent === "dealId" ? v.dealId : v.leadId) ?? ""}`, { id: v.id, value: v.value });
  }

  type Op = { plan: Plan; id: string | null; before: Record<string, unknown>; changed: Record<string, unknown>; custom: CustomChange };
  const ops: Op[] = [];
  for (const plan of plans) {
    const row = byPipedriveId.get(plan.pipedriveId);
    if (!row) {
      bump(log.counts, `${phase}.created`);
      ops.push({ plan, id: null, before: {}, changed: plan.values, custom: { creates: plan.custom, updates: [] } });
      continue;
    }
    const id = row.id as string;
    const changed = keepGuessedValues(changedFields(row, plan.values), row, work.fallback);
    const custom: CustomChange = { creates: [], updates: [] };
    for (const value of plan.custom) {
      const stored = storedValues.get(`${value.fieldId}|${id}`);
      if (!stored) custom.creates.push(value);
      else if (stored.value !== value.value) custom.updates.push({ id: stored.id, value: value.value });
    }
    if (Object.keys(changed).length === 0 && custom.creates.length === 0 && custom.updates.length === 0) {
      bump(log.counts, `${phase}.unchanged`);
      continue;
    }
    bump(log.counts, `${phase}.updated`);
    ops.push({ plan, id, before: Object.fromEntries(Object.keys(changed).map((key) => [key, row[key]])), changed, custom });
  }
  if (!work.live) return true;

  for (let start = 0; start < ops.length; start += BATCH_MAX) {
    // Checked between batches only: the first batch of a page always runs, so a page always moves forward.
    if (start > 0 && work.outOfTime()) return false;
    const batch = ops.slice(start, start + BATCH_MAX);
    await prisma.$transaction(async (tx) => writeBatch(tx, phase, batch), TRANSACTION);
  }
  return true;

  async function writeBatch(tx: Prisma.TransactionClient, rowPhase: RowPhase, batch: Op[]): Promise<void> {
    const delegate = table(tx, name);
    const fresh = batch.filter((op) => op.id === null);
    if (fresh.length > 0) {
      // skipDuplicates: if another request copied the same row a moment ago, the unique Pipedrive id keeps one row.
      await delegate.createMany({
        data: fresh.map((op) => ({ ...op.plan.createOnly, ...op.plan.values, pipedriveId: op.plan.pipedriveId })),
        skipDuplicates: true,
      });
      const created = await delegate.findMany({
        where: { pipedriveId: { in: fresh.map((op) => op.plan.pipedriveId) } },
        select: { id: true, pipedriveId: true },
      });
      const idOf = new Map(created.map((row) => [row.pipedriveId as number | string, row.id as string]));
      for (const op of fresh) op.id = idOf.get(op.plan.pipedriveId) ?? null;
    }
    for (const op of batch) {
      if (!fresh.includes(op) && Object.keys(op.changed).length > 0) await delegate.update({ where: { id: op.id }, data: op.changed });
    }

    if (!parent) return;
    const newValues = batch.flatMap((op) => (op.id ? op.custom.creates.map((v) => ({ fieldId: v.fieldId, [parent]: op.id, value: v.value })) : []));
    if (newValues.length > 0) await tx.salesCustomFieldValue.createMany({ data: newValues, skipDuplicates: true });
    for (const op of batch) for (const u of op.custom.updates) await tx.salesCustomFieldValue.update({ where: { id: u.id }, data: { value: u.value } });

    const entityType = rowPhase === "deals" ? "SalesDeal" : "SalesLead";
    const entries: SalesAuditEntry[] = batch.flatMap((op): SalesAuditEntry[] => {
      if (!op.id) return [];
      if (fresh.includes(op)) return [{ entityType, entityId: op.id, action: "imported", after: { pipedriveId: op.plan.pipedriveId } }];
      const customChanged = op.custom.creates.length + op.custom.updates.length;
      return [
        {
          entityType,
          entityId: op.id,
          action: "import_updated",
          before: jsonable(op.before),
          after: { ...jsonable(op.changed), ...(customChanged > 0 ? { customFieldsChanged: customChanged } : {}) },
        },
      ];
    });
    await recordSalesAuditMany(tx, IMPORT_ACTOR, entries);
  }
}

export function isRowPhase(phase: ImportPhase): phase is RowPhase {
  return phase in TABLE;
}
