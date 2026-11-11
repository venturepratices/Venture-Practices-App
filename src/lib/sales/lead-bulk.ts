import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { canDeleteSalesRecords, dealOwnerWhere, SALES_MEMBER_WHERE, type SalesActor } from "@/lib/sales/access";
import type { SalesRequestMeta } from "@/lib/sales/audit";
import { BULK_IDS_MAX } from "@/lib/sales/constants";
import { fail, type SalesFail } from "@/lib/sales/http";
import { recordLeadAudit } from "@/lib/sales/lead-audit";
import {
  CHOOSE_SALES_MEMBER,
  deleteLead,
  ONLY_ADMIN_DELETES_LEADS,
  setLeadArchived,
  updateLead,
} from "@/lib/sales/leads";

// The Leads Inbox bulk bar: assign, archive, restore or delete up to 100 leads
// in one request. Each lead runs through the same service as the lead panel,
// in its own transaction, so one lead's refusal or race never undoes another's
// change, and each gets its own result (Decision 12). A refusal of the whole
// request (a new owner without Sales access, a delete by someone who is not an
// admin) answers once, before any lead changes.

type Meta = Partial<SalesRequestMeta>;

const INVALID_INPUT = "Invalid input.";
const ID_MAX = 64;

const leadIds = z
  .array(z.string({ error: INVALID_INPUT }).min(1, { error: INVALID_INPUT }).max(ID_MAX, { error: INVALID_INPUT }), {
    error: INVALID_INPUT,
  })
  .min(1, { error: "Pick at least one lead." })
  .max(BULK_IDS_MAX, { error: "Pick up to 100 leads at a time." })
  // A lead ticked twice is changed once.
  .transform((ids) => [...new Set(ids)]);

export const bulkLeadSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("assign"),
      ids: leadIds,
      ownerId: z
        .string({ error: CHOOSE_SALES_MEMBER })
        .min(1, { error: CHOOSE_SALES_MEMBER })
        .max(ID_MAX, { error: CHOOSE_SALES_MEMBER }),
    }),
    z.strictObject({ action: z.literal("archive"), ids: leadIds }),
    z.strictObject({ action: z.literal("restore"), ids: leadIds }),
    z.strictObject({ action: z.literal("delete"), ids: leadIds }),
  ],
  { error: INVALID_INPUT },
);

export type BulkLeadInput = z.infer<typeof bulkLeadSchema>;
export type BulkLeadResult = { id: string; ok: true } | { id: string; ok: false; error: string };

/** Runs one change per lead, one after another (each its own transaction), in the order the ids came. */
async function eachLead(ids: string[], change: (leadId: string) => Promise<{ ok: true } | SalesFail>): Promise<BulkLeadResult[]> {
  const results: BulkLeadResult[] = [];
  for (const id of ids) {
    const result = await change(id);
    results.push(result.ok ? { id, ok: true } : { id, ok: false, error: result.error });
  }
  return results;
}

/**
 * A delete by someone who is not an admin: refused as a whole, with one
 * `delete_refused` row for each lead they can see (Decision 6) and none for
 * the rest, so made-up ids cannot fill the log.
 */
async function refuseDeletes(actor: SalesActor, ids: string[], meta: Meta): Promise<SalesFail> {
  return prisma.$transaction(async (tx) => {
    const visible = await tx.salesLead.findMany({
      where: { id: { in: ids }, archivedAt: null, ...dealOwnerWhere(actor, "everyone") },
      select: { id: true },
    });
    const seen = new Set(visible.map((lead) => lead.id));
    for (const id of ids) {
      if (seen.has(id)) await recordLeadAudit(tx, actor, id, { action: "delete_refused" }, meta);
    }
    // Returned, not thrown, so the transaction commits and the attempts stay on record.
    return fail(403, ONLY_ADMIN_DELETES_LEADS);
  });
}

export async function runLeadBulk(
  actor: SalesActor,
  input: BulkLeadInput,
  meta: Meta,
  now: Date,
): Promise<{ ok: true; results: BulkLeadResult[] } | SalesFail> {
  switch (input.action) {
    case "assign": {
      // Checked once for the whole request; each lead's own transaction checks again.
      const member = await prisma.teamMember.findFirst({
        where: { id: input.ownerId, ...SALES_MEMBER_WHERE },
        select: { id: true },
      });
      if (!member) return fail(400, CHOOSE_SALES_MEMBER);
      return { ok: true, results: await eachLead(input.ids, (id) => updateLead(actor, id, { ownerId: input.ownerId }, meta)) };
    }
    case "archive":
      return { ok: true, results: await eachLead(input.ids, (id) => setLeadArchived(actor, id, true, meta)) };
    case "restore":
      return { ok: true, results: await eachLead(input.ids, (id) => setLeadArchived(actor, id, false, meta)) };
    case "delete":
      if (!canDeleteSalesRecords(actor)) return refuseDeletes(actor, input.ids, meta);
      return { ok: true, results: await eachLead(input.ids, (id) => deleteLead(actor, id, meta, now)) };
  }
}
