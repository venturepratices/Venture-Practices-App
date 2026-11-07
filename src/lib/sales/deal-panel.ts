import type { Prisma } from "@/generated/prisma/client";
import type { SalesActivityType, SalesDealStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { canEditDeal, type SalesActor } from "@/lib/sales/access";
import {
  BOARD_PIPELINE_SELECT,
  isBoardPipeline,
  loadBoardStages,
  loadSalesMembers,
  type BoardPipeline,
  type BoardStage,
  type SalesMemberOption,
} from "@/lib/sales/board";
import { ACTIVITIES_PAGE_SIZE, FILES_PER_DEAL_MAX, TERRITORY_HOLD_FIELD_KEY } from "@/lib/sales/constants";
import { visibleDealWhere } from "@/lib/sales/deal-access";
import { shortName } from "@/lib/sales/format";

// What the slide-in deal panel shows: the deal, its stage bar, the open next
// steps, the Details fields for its pipeline, the territory hold and the
// final-version files. History pages separately (timeline.ts). Plain
// serializable values, dates as ISO strings.

type PanelDb = Pick<
  typeof prisma,
  "salesDeal" | "salesStage" | "salesActivity" | "salesCustomField" | "salesCustomFieldValue" | "teamMember" | "salesFile"
>;

export type PanelActivity = {
  id: string;
  type: SalesActivityType;
  subject: string;
  dueAt: string;
  hasTime: boolean;
  /** A team member id, or the rule that made it ("rule:no-show", "rule:territory-hold"). */
  createdBy: string;
  ownerId: string;
};

/**
 * One final-version file in the deal's Files list (files.ts adds and removes
 * them). Never where it is stored: it downloads only through
 * `GET /api/sales/files/[fileId]`.
 */
export type PanelFile = {
  id: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  /** The deal's stage when the file was added. */
  stageName: string | null;
  /** Who added it, first name and last initial. */
  uploadedBy: string;
  createdAt: string;
  /** The deal owner or an admin. */
  canRemove: boolean;
};

/** What a Files list row reads: no pathname or checksum, so neither reaches the screen. */
export const PANEL_FILE_SELECT = {
  id: true,
  name: true,
  sizeBytes: true,
  contentType: true,
  stageName: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
} satisfies Prisma.SalesFileSelect;

/** A stored file row as the panel shows it. */
export function toPanelFile(row: Prisma.SalesFileGetPayload<{ select: typeof PANEL_FILE_SELECT }>, canRemove: boolean): PanelFile {
  return {
    id: row.id,
    name: row.name,
    sizeBytes: row.sizeBytes,
    contentType: row.contentType,
    stageName: row.stageName,
    uploadedBy: shortName(row.uploadedBy.name),
    createdAt: row.createdAt.toISOString(),
    canRemove,
  };
}

export type PanelField = {
  key: string;
  label: string;
  fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT";
  options: string[];
  /** Stored text; DATE fields are "YYYY-MM-DD". */
  value: string | null;
};

export type DealPanelData = {
  deal: {
    id: string;
    title: string;
    status: SalesDealStatus;
    valueCents: number;
    mrrCents: number;
    stageId: string;
    stageEnteredAt: string;
    lostReason: string | null;
    lostComment: string | null;
    source: string | null;
    owner: SalesMemberOption;
    organization: { id: string; name: string } | null;
    person: { id: string; name: string } | null;
  };
  pipeline: BoardPipeline;
  stages: BoardStage[];
  openActivities: PanelActivity[];
  fields: PanelField[];
  members: SalesMemberOption[];
  /** The deal owner or an admin; everyone else sees the panel read-only. */
  canEdit: boolean;
  /** Set while the Territory Hold Expiry field has a date, with the open check's due time if there is one. */
  territoryHold: { expiry: string; checkDueAt: string | null } | null;
  /** The live final-version files, newest first, at most FILES_PER_DEAL_MAX. */
  files: PanelFile[];
};

const PANEL_DEAL_SELECT = {
  id: true,
  title: true,
  status: true,
  valueCents: true,
  mrrCents: true,
  stageId: true,
  stageEnteredAt: true,
  lostReason: true,
  lostComment: true,
  source: true,
  ownerId: true,
  owner: { select: { id: true, name: true } },
  organization: { select: { id: true, name: true } },
  person: { select: { id: true, name: true } },
  pipeline: { select: BOARD_PIPELINE_SELECT },
} satisfies Prisma.SalesDealSelect;

const TERRITORY_HOLD_RULE = "rule:territory-hold";

/**
 * The panel for one deal, or null when this person may not see it, it is
 * archived or missing, or it sits in a pipeline the board does not show.
 * The caller answers null with "Deal not found." (404).
 */
export async function loadDealPanel(
  actor: SalesActor,
  dealId: string,
  db: PanelDb = prisma,
): Promise<DealPanelData | null> {
  const deal = await db.salesDeal.findFirst({ where: visibleDealWhere(actor, dealId), select: PANEL_DEAL_SELECT });
  if (!deal) return null;
  const pipeline = deal.pipeline;
  if (!isBoardPipeline(pipeline)) return null;

  const [stages, activities, customFields, values, members, files] = await Promise.all([
    loadBoardStages(pipeline.id, db),
    db.salesActivity.findMany({
      where: { dealId, doneAt: null, archivedAt: null },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: ACTIVITIES_PAGE_SIZE,
      select: { id: true, type: true, subject: true, dueAt: true, hasTime: true, createdBy: true, ownerId: true },
    }),
    db.salesCustomField.findMany({
      where: { entity: "DEAL", archivedAt: null },
      orderBy: { position: "asc" },
      select: { id: true, key: true, label: true, fieldType: true, options: true, pipelineKeys: true },
    }),
    db.salesCustomFieldValue.findMany({ where: { dealId }, select: { fieldId: true, value: true } }),
    loadSalesMembers(db),
    db.salesFile.findMany({
      where: { dealId, archivedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: FILES_PER_DEAL_MAX,
      select: PANEL_FILE_SELECT,
    }),
  ]);
  const canEdit = canEditDeal(actor, deal);

  const valueByField = new Map(values.map((row) => [row.fieldId, row.value]));
  const fields: PanelField[] = customFields
    // A field with no pipeline list belongs to every deal pipeline.
    .filter((field) => field.pipelineKeys.length === 0 || field.pipelineKeys.includes(pipeline.key))
    .map((field) => ({
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      options: field.options,
      value: valueByField.get(field.id) ?? null,
    }));

  const openActivities: PanelActivity[] = activities.map((activity) => ({
    ...activity,
    dueAt: activity.dueAt.toISOString(),
  }));

  const holdExpiry = fields.find((field) => field.key === TERRITORY_HOLD_FIELD_KEY)?.value ?? null;
  const holdCheck = openActivities.find((activity) => activity.createdBy === TERRITORY_HOLD_RULE);

  return {
    deal: {
      id: deal.id,
      title: deal.title,
      status: deal.status,
      valueCents: deal.valueCents,
      mrrCents: deal.mrrCents,
      stageId: deal.stageId,
      stageEnteredAt: deal.stageEnteredAt.toISOString(),
      lostReason: deal.lostReason,
      lostComment: deal.lostComment,
      source: deal.source,
      owner: deal.owner,
      organization: deal.organization,
      person: deal.person,
    },
    pipeline: { id: pipeline.id, key: pipeline.key, name: pipeline.name, kind: pipeline.kind },
    stages,
    openActivities,
    fields,
    members,
    canEdit,
    territoryHold: holdExpiry ? { expiry: holdExpiry, checkDueAt: holdCheck?.dueAt ?? null } : null,
    files: files.map((file) => toPanelFile(file, canEdit)),
  };
}
