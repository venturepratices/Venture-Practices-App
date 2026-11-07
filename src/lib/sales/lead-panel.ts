import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canEditDeal, type SalesActor } from "@/lib/sales/access";
import { loadSalesMembers, type SalesMemberOption } from "@/lib/sales/board";
import { ACTIVITIES_PAGE_SIZE } from "@/lib/sales/constants";
import { visibleDealWhere } from "@/lib/sales/deal-access";
import type { PanelActivity, PanelField } from "@/lib/sales/deal-panel";
import { visibleLeadWhere } from "@/lib/sales/lead-access";

// What the slide-in lead panel shows (spec 7.6, "same pattern as deal panel"):
// the lead, its open next steps, its Details fields, the people who can own it,
// and, once converted, the deal it became. History pages separately
// (timeline.ts). Plain serializable values, dates as ISO strings.

type LeadPanelDb = Pick<
  typeof prisma,
  "salesLead" | "salesDeal" | "salesActivity" | "salesCustomField" | "salesCustomFieldValue" | "teamMember"
>;

/** Lead fields the panel never shows: Source and Organization say the same thing (Decision 8). */
export const LEAD_HIDDEN_FIELD_KEYS = ["form-source", "practice-name"] as const;

export type LeadPanelData = {
  lead: {
    id: string;
    title: string;
    status: "OPEN" | "CONVERTED" | "ARCHIVED";
    source: string;
    createdAt: string;
    owner: SalesMemberOption;
    organization: { id: string; name: string } | null;
    person: { id: string; name: string } | null;
  };
  /** The deal a converted lead became, only when this person may open it. */
  convertedDeal: { id: string; title: string } | null;
  openActivities: PanelActivity[];
  fields: PanelField[];
  members: SalesMemberOption[];
  /** The lead owner or an admin, while the lead is open. Everyone else, and every converted or archived lead, is read-only. */
  canEdit: boolean;
  /** The lead owner or an admin, while the lead is archived: the one change an archived lead takes. */
  canRestore: boolean;
};

const PANEL_LEAD_SELECT = {
  id: true,
  title: true,
  status: true,
  source: true,
  createdAt: true,
  ownerId: true,
  convertedDealId: true,
  owner: { select: { id: true, name: true } },
  organization: { select: { id: true, name: true } },
  person: { select: { id: true, name: true } },
} satisfies Prisma.SalesLeadSelect;

/**
 * The panel for one lead, or null when this person may not see it, or it is
 * deleted or missing. The caller answers null with "Lead not found." (404).
 * An archived lead (status ARCHIVED) still opens, read-only, with Restore.
 */
export async function loadLeadPanel(
  actor: SalesActor,
  leadId: string,
  db: LeadPanelDb = prisma,
): Promise<LeadPanelData | null> {
  const lead = await db.salesLead.findFirst({ where: visibleLeadWhere(actor, leadId), select: PANEL_LEAD_SELECT });
  if (!lead) return null;

  const [activities, customFields, values, members, convertedDeal] = await Promise.all([
    // An activity that moved to the deal on convert (dealId set) belongs to the deal now.
    db.salesActivity.findMany({
      where: { leadId, dealId: null, doneAt: null, archivedAt: null },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: ACTIVITIES_PAGE_SIZE,
      select: { id: true, type: true, subject: true, dueAt: true, hasTime: true, createdBy: true, ownerId: true },
    }),
    db.salesCustomField.findMany({
      where: { entity: "LEAD", archivedAt: null, key: { notIn: [...LEAD_HIDDEN_FIELD_KEYS] } },
      orderBy: { position: "asc" },
      select: { id: true, key: true, label: true, fieldType: true, options: true },
    }),
    db.salesCustomFieldValue.findMany({ where: { leadId }, select: { fieldId: true, value: true } }),
    loadSalesMembers(db),
    lead.status === "CONVERTED" && lead.convertedDealId
      ? db.salesDeal.findFirst({ where: visibleDealWhere(actor, lead.convertedDealId), select: { id: true, title: true } })
      : Promise.resolve(null),
  ]);

  const valueByField = new Map(values.map((row) => [row.fieldId, row.value]));
  const fields: PanelField[] = customFields.map((field) => ({
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    options: field.options,
    value: valueByField.get(field.id) ?? null,
  }));

  const ownerOrAdmin = canEditDeal(actor, lead);
  return {
    lead: {
      id: lead.id,
      title: lead.title,
      status: lead.status,
      source: lead.source,
      createdAt: lead.createdAt.toISOString(),
      owner: lead.owner,
      organization: lead.organization,
      person: lead.person,
    },
    convertedDeal: convertedDeal ? { id: convertedDeal.id, title: convertedDeal.title } : null,
    openActivities: activities.map((activity) => ({ ...activity, dueAt: activity.dueAt.toISOString() })),
    fields,
    members,
    canEdit: ownerOrAdmin && lead.status === "OPEN",
    canRestore: ownerOrAdmin && lead.status === "ARCHIVED",
  };
}
