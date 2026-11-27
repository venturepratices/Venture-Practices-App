// The check report for the Pipedrive import. For each kind of record it says
// how many Pipedrive has against how many the app copied, and picks a few
// imported deals to compare by eye. It reads only: Pipedrive through the
// read-only client, the app through counts and a handful of one-row lookups.
//
// Pipedrive's side counts what the engine is meant to copy, so it reads the
// same lists the engine reads (ROW_SOURCES) and runs each record through the
// same mapper. A record the mapper refuses (a deleted deal, an empty note) is
// not a missing row, so it is left out of the count.
//
// A walk of a whole list costs API requests, once per list on every check.

import { prisma } from "@/lib/prisma";
import type { PipedriveClient } from "@/lib/sales/pipedrive/client";
import { PAGE_LIMIT, ROW_SOURCES } from "@/lib/sales/pipedrive/import-rows";
import {
  mapActivity,
  mapDeal,
  mapLead,
  mapNote,
  mapOrganization,
  mapPerson,
  type PipedriveActivity,
  type PipedriveDeal,
  type PipedriveLead,
  type PipedriveNote,
  type PipedriveOrganization,
  type PipedrivePerson,
} from "@/lib/sales/pipedrive/map";

export type CheckEntity = "organizations" | "persons" | "deals" | "leads" | "activities" | "notes";

export type CheckRow = {
  label: string;
  entity: CheckEntity;
  /** Records Pipedrive has that the engine is meant to copy. */
  pipedrive: number;
  /** Rows in the app that came from Pipedrive. */
  app: number;
  /** Records the engine left out on purpose (not counting the ones the mapper refuses). They make up part of the difference. */
  skipped: number;
  ok: boolean;
};

export type SpotCheck = {
  title: string;
  valueCents: number;
  stage: string;
  owner: string;
  status: string;
  pipedriveId: number;
};

/** In the order the report shows them. */
const ENTITIES: { entity: CheckEntity; label: string }[] = [
  { entity: "organizations", label: "Organizations" },
  { entity: "persons", label: "People" },
  { entity: "deals", label: "Deals" },
  { entity: "leads", label: "Leads" },
  { entity: "activities", label: "Activities" },
  { entity: "notes", label: "Notes" },
];

/**
 * A cursor list (API v2) allows 500 a page, so a count takes a fifth of the
 * requests the engine's 100 would (archived lists excepted, see where it is
 * used). Offset lists stay at the engine's page size: leads send no pagination
 * block, so a short page is what ends the walk, and a page size Pipedrive
 * quietly cuts down would end the count early.
 */
const CURSOR_PAGE_LIMIT = 500;

/** How many deals the spot check shows. */
const SPOT_COUNT = 5;

/** Only rows that came from Pipedrive, never ones made by hand in the app. */
const IMPORTED = { pipedriveId: { not: null } };

/** The mappers need a date for records with no created date. Whether one is skipped never depends on it. */
const UNUSED_DATE = new Date(0);

type Mapper = (record: Record<string, unknown>, fallback: Date) => object;

const MAPPERS: Record<CheckEntity, Mapper> = {
  organizations: (record, date) => mapOrganization(record as unknown as PipedriveOrganization, date),
  persons: (record, date) => mapPerson(record as unknown as PipedrivePerson, date),
  deals: (record, date) => mapDeal(record as unknown as PipedriveDeal, date),
  leads: (record, date) => mapLead(record as unknown as PipedriveLead, date),
  activities: (record, date) => mapActivity(record as unknown as PipedriveActivity, date),
  notes: (record, date) => mapNote(record as unknown as PipedriveNote, date),
};

const APP_COUNTS: Record<CheckEntity, () => Promise<number>> = {
  organizations: () => prisma.salesOrganization.count({ where: IMPORTED }),
  persons: () => prisma.salesPerson.count({ where: IMPORTED }),
  deals: () => prisma.salesDeal.count({ where: IMPORTED }),
  leads: () => prisma.salesLead.count({ where: IMPORTED }),
  activities: () => prisma.salesActivity.count({ where: IMPORTED }),
  notes: () => prisma.salesNote.count({ where: IMPORTED }),
};

/**
 * Walks every list the engine reads for this kind and counts the records it is
 * meant to copy, and the ones its mapper refuses. A PipedriveError from the
 * client is not caught here: the caller words it for the screen.
 */
async function countInPipedrive(client: PipedriveClient, entity: CheckEntity): Promise<{ copyable: number; refused: number }> {
  const map = MAPPERS[entity];
  let copyable = 0;
  let refused = 0;
  for (const source of ROW_SOURCES[entity]) {
    // An archived list keeps the engine's page size: Pipedrive documents the 500 a page for the main lists only.
    const limit = source.style === "cursor" && !source.archived ? CURSOR_PAGE_LIMIT : PAGE_LIMIT;
    for await (const batch of client.pageBatches<Record<string, unknown>>(source.path, { style: source.style, limit })) {
      for (const record of batch.items) {
        if ("skip" in map(record, UNUSED_DATE)) refused += 1;
        else copyable += 1;
      }
    }
  }
  return { copyable, refused };
}

/**
 * Spec section 10.2: close enough is within 1% either way, and under 100
 * records every one must be there. Whole-number math, so 990 of 1000 is
 * exactly on the line and never lost to rounding.
 */
function countsMatch(pipedrive: number, app: number): boolean {
  const gap = Math.abs(pipedrive - app);
  return pipedrive < 100 ? gap === 0 : gap * 100 <= pipedrive;
}

/**
 * `skipped` is the latest run's own skip count per kind (`${entity}.skipped` in
 * its counts). That count includes the records the mapper refuses, which the
 * Pipedrive side already leaves out, so those are taken off before the rest is
 * allowed to make up a difference. Without that, a deleted deal would be
 * credited twice and an overcount would pass.
 */
export async function buildCheckReport(
  client: PipedriveClient,
  pickIndexes: (total: number) => number[],
  skipped: Partial<Record<CheckEntity, number>> = {},
): Promise<{ rows: CheckRow[]; spot: SpotCheck[] }> {
  const rows: CheckRow[] = [];
  // One at a time, so a check never sends Pipedrive a burst of requests.
  for (const { entity, label } of ENTITIES) {
    const pipedrive = await countInPipedrive(client, entity);
    const app = await APP_COUNTS[entity]();
    const onPurpose = Math.max(0, (skipped[entity] ?? 0) - pipedrive.refused);
    rows.push({ label, entity, pipedrive: pipedrive.copyable, app, skipped: onPurpose, ok: countsMatch(pipedrive.copyable, app + onPurpose) });
  }

  const dealsInApp = rows.find((row) => row.entity === "deals")?.app ?? 0;
  return { rows, spot: await spotCheck(dealsInApp, pickIndexes) };
}

/**
 * Up to 5 imported deals, at the positions `pickIndexes` chose among `total`
 * (counting from 0, in id order). Positions that repeat or fall outside the
 * list are dropped, so the result is never more than 5 and never a lookup for
 * a deal that is not there.
 */
async function spotCheck(total: number, pickIndexes: (total: number) => number[]): Promise<SpotCheck[]> {
  if (total === 0) return [];
  const positions = [...new Set(pickIndexes(total))].filter((at) => Number.isInteger(at) && at >= 0 && at < total).slice(0, SPOT_COUNT);
  const found = await Promise.all(
    positions.map((skip) =>
      prisma.salesDeal.findMany({
        where: IMPORTED,
        orderBy: { id: "asc" },
        skip,
        take: 1,
        select: {
          title: true,
          valueCents: true,
          status: true,
          pipedriveId: true,
          stage: { select: { name: true } },
          owner: { select: { name: true } },
        },
      }),
    ),
  );
  // A deal can be gone by now (the check is not run in one instant), so a missing one is left out rather than failing the report.
  return found.flatMap(([deal]) =>
    deal && deal.pipedriveId !== null
      ? [
          {
            title: deal.title,
            valueCents: deal.valueCents,
            stage: deal.stage.name,
            owner: deal.owner.name,
            status: deal.status,
            pipedriveId: deal.pipedriveId,
          },
        ]
      : [],
  );
}
